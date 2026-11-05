import type { Ledger, LedgerAgent, LedgerEntry, LedgerEntryInput } from "@athera/ledger";
import { nearblocksTx } from "@athera/ledger";
import { HaltError, fmt, type KillSwitch, type PolicyCheck, type PolicyEngine, type Proposal } from "@athera/policy";
import type { CreatedIntent, Settlement, SettledIntent, SubmittedIntent } from "@athera/settlement";
import { AccountingAgent, type SettledBasis } from "./accounting.ts";
import { deriveState, pendingAccounting, type MovementPayload } from "./state.ts";
import { TreasuryAgent, type TreasuryInstruction } from "./treasury.ts";

export interface LoopDeps {
  readonly policy: PolicyEngine;
  readonly settlement: Settlement;
  readonly ledger: Ledger;
  readonly killSwitch: KillSwitch;
  /** Live balances inside the verifier, keyed `${account}|${asset}`. */
  readonly readBalances: () => Promise<Record<string, bigint>>;
}

type Log = (e: Omit<LedgerEntryInput, "run_id" | "policy">) => LedgerEntry;

export type LoopOutcome =
  | { status: "completed"; runId: string; entries: LedgerEntry[] }
  | { status: "blocked"; runId: string; entries: LedgerEntry[]; check: PolicyCheck }
  | { status: "halted"; runId: string; entries: LedgerEntry[]; stage: string }
  | { status: "failed"; runId: string; entries: LedgerEntry[]; error: string };

export const newRunId = (now = new Date()) =>
  `r${now.toISOString().replace(/[-:TZ.]/g, "").slice(2, 14)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * One loop: propose → check → create → submit → track → fee (check → … → track) →
 * split (check → … → track). The kill switch is checked before every stage; every
 * material step is appended to the ledger before the next one starts.
 */
export class Orchestrator {
  private readonly treasury: TreasuryAgent;
  private readonly accounting: AccountingAgent;

  constructor(private readonly d: LoopDeps) {
    this.treasury = new TreasuryAgent(d.policy.config);
    this.accounting = new AccountingAgent(d.policy.config);
  }

  async run(instruction: TreasuryInstruction, runId = newRunId()): Promise<LoopOutcome> {
    const entries: LedgerEntry[] = [];
    const log: Log = (e) => {
      const entry = this.d.ledger.append({ ...e, run_id: runId, policy: this.d.policy.ref });
      entries.push(entry);
      return entry;
    };

    try {
      // Stage A: principal movement proposed by Treasury.
      this.guard("proposal", log);
      const principal = this.treasury.propose(`${runId}-t`, instruction);
      const a = await this.settle(principal, "treasury", log, []);
      if (a.kind === "blocked") return { status: "blocked", runId, entries, check: a.check };
      const leg0 = principal.legs[0];
      if (!leg0) throw new Error("principal has no legs");

      // Stages B + C: Accounting collects the fee, then pays out the revenue split.
      const bc = await this.feeAndSplit(runId, log, { ref: a.settlementEntry.id, asset: leg0.asset, amount: leg0.amount });
      if (bc) return { status: "blocked", runId, entries, check: bc };
      return { status: "completed", runId, entries };
    } catch (err) {
      if (err instanceof HaltError) {
        if (!entries.some((e) => e.type === "halt")) this.logHalt(log, err.stage, err.reason);
        return { status: "halted", runId, entries, stage: err.stage };
      }
      const msg = err instanceof Error ? err.message : String(err);
      log({ agent: "system", type: "error", result: "failed", summary: `Loop stopped: ${msg}`, payload: { error: msg } });
      return { status: "failed", runId, entries, error: msg };
    }
  }

  /** Stage B (fee on a settled principal) then stage C (split of that fee). Returns a blocking check, if any. */
  private async feeAndSplit(runId: string, log: Log, principal: SettledBasis): Promise<PolicyCheck | undefined> {
    this.guard("fee proposal", log);
    const feeProposal = this.accounting.proposeFee(`${runId}-f`, principal);
    const b = await this.settle(feeProposal, "accounting", log, [principal.ref]);
    if (b.kind === "blocked") return b.check;
    const feeLeg = feeProposal.legs[0];
    if (!feeLeg) throw new Error("fee has no legs");
    const feeEntry = log({
      agent: "accounting",
      type: "fee",
      result: "confirmed",
      summary: `Fee collected: ${fmt(this.d.policy.config, feeLeg.asset, BigInt(feeLeg.amount))} to ${feeLeg.to}.`,
      amount: this.amount(feeLeg.asset, feeLeg.amount),
      refs: this.refsOf(b.settled),
      upstream: [b.settlementEntry.id],
      payload: { basis: feeProposal.basis },
    });
    return this.split(runId, log, { ref: feeEntry.id, asset: feeLeg.asset, amount: feeLeg.amount });
  }

  private async split(runId: string, log: Log, fee: SettledBasis): Promise<PolicyCheck | undefined> {
    this.guard("revenue split", log);
    const splitProposal = this.accounting.proposeSplit(`${runId}-s`, fee);
    const c = await this.settle(splitProposal, "accounting", log, [fee.ref]);
    if (c.kind === "blocked") return c.check;
    for (const l of splitProposal.legs) {
      log({
        agent: "accounting",
        type: "payout",
        result: "confirmed",
        summary: `Revenue split paid: ${fmt(this.d.policy.config, l.asset, BigInt(l.amount))} to ${l.to}.`,
        amount: this.amount(l.asset, l.amount),
        refs: this.refsOf(c.settled),
        upstream: [c.settlementEntry.id],
      });
    }
    return undefined;
  }

  /**
   * Finish work a halt (or crash) left half-done, from the ledger alone: confirmed principal
   * settlements with no fee get fee + split; collected fees with no split get the split.
   * Every step still goes through the policy engine; fee_rule / revenue_split_rule also refuse
   * to charge or pay twice for the same basis.
   */
  async reconcile(runId = newRunId()): Promise<{ status: LoopOutcome["status"]; runId: string; entries: LedgerEntry[]; handled: number }> {
    const entries: LedgerEntry[] = [];
    const log: Log = (e) => {
      const entry = this.d.ledger.append({ ...e, run_id: runId, policy: this.d.policy.ref });
      entries.push(entry);
      return entry;
    };
    const { principals, fees } = pendingAccounting(this.d.ledger.all());
    let handled = 0;
    try {
      for (const p of principals) {
        const blocked = await this.feeAndSplit(`${runId}-${handled}`, log, p);
        handled++;
        if (blocked) return { status: "blocked", runId, entries, handled };
      }
      for (const f of fees) {
        const blocked = await this.split(`${runId}-${handled}`, log, f);
        handled++;
        if (blocked) return { status: "blocked", runId, entries, handled };
      }
      return { status: "completed", runId, entries, handled };
    } catch (err) {
      if (err instanceof HaltError) {
        if (!entries.some((e) => e.type === "halt")) this.logHalt(log, err.stage, err.reason);
        return { status: "halted", runId, entries, handled };
      }
      const msg = err instanceof Error ? err.message : String(err);
      log({ agent: "system", type: "error", result: "failed", summary: `Reconcile stopped: ${msg}`, payload: { error: msg } });
      return { status: "failed", runId, entries, handled };
    }
  }

  /** Validate a proposal only (used by the "trigger invalid action" path). Never reaches Settlement. */
  async checkOnly(proposal: unknown, agent: LedgerAgent, runId = newRunId()): Promise<{ check: PolicyCheck; entry: LedgerEntry }> {
    const balances = await this.d.readBalances();
    const state = deriveState(this.d.ledger.all(), balances, this.d.killSwitch.state().engaged);
    const check = this.d.policy.validate(proposal, state);
    const entry = this.d.ledger.append({
      run_id: runId,
      policy: this.d.policy.ref,
      agent: "policy",
      type: "policy_check",
      result: check.result,
      summary: check.summary,
      refs: { proposal_id: check.proposalId },
      payload: { rules: check.rules, proposal, proposed_by: agent, balances: stringify(balances) },
    });
    return { check, entry };
  }

  private async settle(
    p: Proposal,
    agent: LedgerAgent,
    log: (e: Omit<LedgerEntryInput, "run_id" | "policy">) => LedgerEntry,
    upstream: string[],
  ): Promise<{ kind: "blocked"; check: PolicyCheck } | { kind: "settled"; settled: SettledIntent; settlementEntry: LedgerEntry }> {
    const cfg = this.d.policy.config;
    const total = p.legs.reduce((s, l) => s + BigInt(l.amount), 0n);
    const asset = p.legs[0]?.asset;
    const amount = asset ? this.amount(asset, total.toString()) : undefined;

    const proposalEntry = log({
      agent,
      type: "proposal",
      result: "info",
      summary: `${agent} proposed ${p.kind}${asset ? ` ${fmt(cfg, asset, total)}` : ""} from ${p.from}: ${p.reason}.`,
      ...(amount ? { amount } : {}),
      refs: { proposal_id: p.id },
      upstream,
      payload: p,
    });

    this.guard("policy check", log);
    const balances = await this.d.readBalances();
    const state = deriveState(this.d.ledger.all(), balances, this.d.killSwitch.state().engaged);
    const check = this.d.policy.validate(p, state);
    const checkEntry = log({
      agent: "policy",
      type: "policy_check",
      result: check.result,
      summary: check.summary,
      ...(amount ? { amount } : {}),
      refs: { proposal_id: p.id },
      upstream: [proposalEntry.id],
      payload: { rules: check.rules, proposal_hash: check.proposalHash, balances: stringify(balances) },
    });
    if (check.result === "block") return { kind: "blocked", check };

    this.guard("intent creation", log);
    const created: CreatedIntent = await this.d.settlement.create(check);
    const createdEntry = log({
      agent: "settlement",
      type: "intent_created",
      result: "pending",
      summary: `Intent created: ${created.intents.length} transfer(s) signed by ${created.signerId}, memo ${created.memo}.`,
      ...(amount ? { amount } : {}),
      refs: { proposal_id: p.id, intent_hash: created.intentHash, signer_id: created.signerId, memo: created.memo },
      upstream: [checkEntry.id],
      payload: { message: created.payload.message, deadline: created.deadline },
    });

    this.guard("signing and submission", log);
    const sub: SubmittedIntent = await this.d.settlement.submit(created);
    const movement: MovementPayload = { kind: p.kind, from: p.from, legs: p.legs, ...(p.basis ? { basis_ref: p.basis.ref } : {}) };
    const submittedEntry = log({
      agent: "settlement",
      type: "intent_submitted",
      result: "pending",
      summary: `Intent submitted to ${this.d.settlement.verifier} in tx ${sub.txHash}.`,
      ...(amount ? { amount } : {}),
      refs: { proposal_id: p.id, intent_hash: sub.intentHash, tx_hash: sub.txHash, signer_id: sub.signerId, memo: sub.memo, explorer: [nearblocksTx(sub.txHash)] },
      upstream: [createdEntry.id],
      payload: movement,
    });

    let settled: SettledIntent;
    try {
      settled = await this.d.settlement.track(sub);
    } catch (err) {
      log({
        agent: "settlement",
        type: "settlement",
        result: "failed",
        summary: `Settlement failed for tx ${sub.txHash}: ${err instanceof Error ? err.message : String(err)}`,
        refs: { proposal_id: p.id, intent_hash: sub.intentHash, tx_hash: sub.txHash, explorer: [nearblocksTx(sub.txHash)] },
        upstream: [submittedEntry.id],
      });
      throw err;
    }
    const settlementEntry = log({
      agent: "settlement",
      type: "settlement",
      result: "confirmed",
      summary: `Settled: ${p.kind}${asset ? ` ${fmt(cfg, asset, total)}` : ""} final in block ${settled.blockHeight}.`,
      ...(amount ? { amount } : {}),
      refs: this.refsOf(settled),
      upstream: [submittedEntry.id],
      payload: { events: settled.events, receipt_id: settled.receiptId },
    });
    return { kind: "settled", settled, settlementEntry };
  }

  /** Synchronous kill-switch check. Never awaits. */
  private guard(stage: string, log: (e: Omit<LedgerEntryInput, "run_id" | "policy">) => LedgerEntry): void {
    const ks = this.d.killSwitch.state();
    const reason = ks.engaged ? (ks.reason ?? "operator halt") : this.d.policy.config.kill_switch ? "kill_switch: true in config.yaml" : undefined;
    if (reason) {
      this.logHalt(log, stage, reason);
      throw new HaltError(stage, reason);
    }
  }

  private logHalt(log: (e: Omit<LedgerEntryInput, "run_id" | "policy">) => LedgerEntry, stage: string, reason: string) {
    log({ agent: "operator", type: "halt", result: "halted", summary: `Halted before ${stage}: ${reason}.`, payload: { stage, reason } });
  }

  private refsOf(s: SettledIntent) {
    return {
      proposal_id: s.proposalId,
      intent_hash: s.intentHash,
      tx_hash: s.txHash,
      signer_id: s.signerId,
      block_hash: s.blockHash,
      block_height: s.blockHeight,
      memo: s.memo,
      explorer: [nearblocksTx(s.txHash)],
    };
  }

  private amount(asset: string, value: string) {
    return { asset, value, display: fmt(this.d.policy.config, asset, BigInt(value)) };
  }
}

const stringify = (b: Record<string, bigint>) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toString()]));
