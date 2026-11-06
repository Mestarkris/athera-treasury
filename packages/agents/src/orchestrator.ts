import type { Ledger, LedgerAgent, LedgerEntry, LedgerEntryInput } from "@athera/ledger";
import { nearblocksTx } from "@athera/ledger";
import { HaltError, fmt, type KillSwitch, type PolicyCheck, type PolicyEngine, type Proposal } from "@athera/policy";
import type { CreatedIntent, Settlement, SettledIntent, SubmittedIntent } from "@athera/settlement";
import { AccountingAgent, type SettledBasis } from "./accounting.ts";
import { deriveState, pendingAccounting, type MovementPayload } from "./state.ts";
import { TreasuryAgent, type TreasuryInstruction } from "./treasury.ts";
import { meteredChat } from "./ai/metered.ts";
import type { NearAiClient } from "./ai/nearai.ts";
import { gatherFacts, parseAnalysis, reportPrompt, type ChainReader, type Report, type ReportStore } from "./sales/analyst.ts";
import type { OneClickClient, StatusResult } from "./sales/oneclick.ts";
import { SalesAgent, type Order } from "./sales/sales.ts";

/** What the sale loop needs on top of the movement loop. */
export interface SaleDeps {
  readonly oneclick: OneClickClient;
  readonly ai: NearAiClient;
  readonly rpc: ChainReader;
  readonly reports: ReportStore;
  /** Model for the report; must be in config inference.approved_models. */
  readonly model?: string;
  /** Output token budget for the report call. */
  readonly maxTokens?: number;
  /** Swap status polling (tests pass a no-op sleep). */
  readonly poll?: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
}

export interface LoopDeps {
  readonly policy: PolicyEngine;
  readonly settlement: Settlement;
  readonly ledger: Ledger;
  readonly killSwitch: KillSwitch;
  /** Live balances inside the verifier, keyed `${account}|${asset}`. */
  readonly readBalances: () => Promise<Record<string, bigint>>;
  readonly sales?: SaleDeps;
}

type Log = (e: Omit<LedgerEntryInput, "run_id" | "policy">) => LedgerEntry;

export type LoopOutcome =
  | { status: "completed"; runId: string; entries: LedgerEntry[]; reportId?: string }
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
  private readonly salesAgent: SalesAgent;

  constructor(private readonly d: LoopDeps) {
    this.treasury = new TreasuryAgent(d.policy.config);
    this.accounting = new AccountingAgent(d.policy.config);
    this.salesAgent = new SalesAgent(d.policy.config);
  }

  private logger(runId: string, entries: LedgerEntry[]): Log {
    return (e) => {
      const entry = this.d.ledger.append({ ...e, run_id: runId, policy: this.d.policy.ref });
      entries.push(entry);
      return entry;
    };
  }

  /**
   * The business loop: Sales offers a treasury report (pricing_rule) → 1Click quotes the price in
   * USDC to Athera's revenue account → the customer pays the quote's deposit address with a
   * signed transfer intent (purchase_rule + every movement rule) → 1Click's solvers settle →
   * the Analyst reads the subject's chain data and writes the report with a metered AI call
   * (inference_budget) → Accounting splits the USDC revenue per config.
   */
  async runSale(order: Order, runId = newRunId()): Promise<LoopOutcome> {
    const sd = this.d.sales;
    if (!sd) throw new Error("sale loop needs SaleDeps (1Click, NEAR AI, RPC, report store)");
    const cfg = this.d.policy.config;
    const salesCfg = cfg.sales;
    const inference = cfg.inference;
    if (!salesCfg || !inference) throw new Error("config.yaml has no sales or inference section; nothing is for sale");
    const entries: LedgerEntry[] = [];
    const log = this.logger(runId, entries);
    try {
      // 1. Offer, checked against the price bounds. No value moves.
      this.guard("sale offer", log);
      const offer = this.salesAgent.offer(`${runId}-o`, order);
      const offerProposal = log({
        agent: "sales",
        type: "proposal",
        result: "info",
        summary: `sales offered ${offer.offer?.product} on ${order.subject} to ${order.customer} for $${offer.offer?.price_usd}.`,
        refs: { proposal_id: offer.id },
        payload: offer,
      });
      const offerCheck = await this.checkLogged(offer, log, [offerProposal.id]);
      if (offerCheck.check.result === "block") return { status: "blocked", runId, entries, check: offerCheck.check };
      const price = offer.offer!.price_usd;

      // 2. 1Click quote: exactly the price in USDC to the revenue account, inside the verifier.
      this.guard("quote", log);
      const quote = await sd.oneclick.quote({
        originAsset: cfg.approved.assets[0]!,
        destinationAsset: salesCfg.settle_asset,
        amountOut: this.salesAgent.settleAmount(price),
        recipient: cfg.accounts.revenue,
        refundTo: order.customer,
        deadline: new Date(Date.now() + 10 * 60_000),
      });
      const quoteEntry = log({
        agent: "sales",
        type: "quote",
        result: "info",
        summary: `1Click quoted ${fmt(cfg, quote.originAsset, BigInt(quote.amountIn))} for ${fmt(cfg, quote.destinationAsset, BigInt(quote.amountOut))} to ${cfg.accounts.revenue}, deposit ${quote.depositAddress.slice(0, 10)}…`,
        amount: this.amount(quote.destinationAsset, quote.amountOut),
        upstream: [offerCheck.entry.id],
        payload: quote,
      });

      // 3. The customer pays the deposit address. Every movement rule plus purchase_rule apply.
      this.guard("purchase proposal", log);
      const purchase = this.salesAgent.purchase(`${runId}-p`, order.customer, quote);
      const paid = await this.settle(purchase, "treasury", log, [quoteEntry.id]);
      if (paid.kind === "blocked") return { status: "blocked", runId, entries, check: paid.check };

      // 4. 1Click's solvers swap and deliver USDC to Athera's revenue account.
      this.guard("swap settlement", log);
      const final: StatusResult = await sd.oneclick.waitFinal(quote.depositAddress, sd.poll ?? {});
      if (final.status !== "SUCCESS") {
        log({
          agent: "sales",
          type: "sale",
          result: "failed",
          summary: `1Click swap ended ${final.status}${final.refundedAmount ? `, refunded ${final.refundedAmount}` : ""}; no sale recorded.`,
          upstream: [paid.settlementEntry.id],
          payload: final,
        });
        return { status: "failed", runId, entries, error: `1Click swap ${final.status}` };
      }
      const received = final.amountOut ?? quote.amountOut;
      const sale = log({
        agent: "sales",
        type: "sale",
        result: "confirmed",
        summary: `Sale: ${salesCfg.product} on ${order.subject}, ${fmt(cfg, salesCfg.settle_asset, BigInt(received))} received by ${cfg.accounts.revenue}.`,
        amount: this.amount(salesCfg.settle_asset, received),
        refs: {
          proposal_id: purchase.id,
          ...(final.intentHashes[0] ? { intent_hash: final.intentHashes[0] } : {}),
          ...(final.nearTxHashes[0] ? { tx_hash: final.nearTxHashes[0] } : {}),
          explorer: final.nearTxHashes.map(nearblocksTx),
        },
        upstream: [paid.settlementEntry.id],
        payload: { deposit_address: quote.depositAddress, status: final.status, intent_hashes: final.intentHashes, near_tx_hashes: final.nearTxHashes, price_usd: price },
      });

      // 5. Revenue split first: it depends only on money already received.
      const splitBlock = await this.split(runId, log, { ref: sale.id, asset: salesCfg.settle_asset, amount: received });
      if (splitBlock) return { status: "blocked", runId, entries, check: splitBlock };

      // 6. The Analyst writes the report the customer paid for, with a metered AI call.
      const delivered = await this.deliverReport(runId, log, {
        sale,
        subject: order.subject,
        customer: order.customer,
        price,
        offerRef: offerCheck.entry.id,
        payment: { deposit_address: quote.depositAddress, intent_hashes: final.intentHashes, near_tx_hashes: final.nearTxHashes },
      });
      if ("check" in delivered) return { status: "blocked", runId, entries, check: delivered.check };
      const reportId = delivered.reportId;
      return { status: "completed", runId, entries, reportId };
    } catch (err) {
      if (err instanceof HaltError) {
        if (!entries.some((e) => e.type === "halt")) this.logHalt(log, err.stage, err.reason);
        return { status: "halted", runId, entries, stage: err.stage };
      }
      const msg = err instanceof Error ? err.message : String(err);
      log({ agent: "system", type: "error", result: "failed", summary: `Sale stopped: ${msg}`, payload: { error: msg } });
      return { status: "failed", runId, entries, error: msg };
    }
  }

  /**
   * Write the report for a confirmed sale that has none (for example after the AI call failed).
   * Everything comes from the ledger: the sale entry and the offer in the same run. Nothing is
   * paid again; only the metered AI call is made.
   */
  async retryReport(saleId: string, runId = newRunId()): Promise<LoopOutcome> {
    const entries: LedgerEntry[] = [];
    const log = this.logger(runId, entries);
    try {
      const all = this.d.ledger.all();
      const sale = all.find((e) => e.id === saleId && e.type === "sale" && e.result === "confirmed");
      if (!sale) throw new Error(`no confirmed sale ${saleId} in the ledger`);
      const done = all.find((e) => e.type === "report" && e.upstream?.includes(sale.id));
      if (done) throw new Error(`sale ${saleId} already has report entry ${done.id}`);
      const offerEntry = all.find((e) => e.run_id === sale.run_id && e.type === "proposal" && (e.payload as Proposal | undefined)?.kind === "sale_offer");
      const offer = (offerEntry?.payload as Proposal | undefined)?.offer;
      if (!offerEntry || !offer) throw new Error(`no sale offer found for run ${sale.run_id}`);
      const offerCheck = all.find((e) => e.type === "policy_check" && e.upstream?.includes(offerEntry.id));
      const pay = sale.payload as { deposit_address?: string; intent_hashes?: string[]; near_tx_hashes?: string[] } | undefined;
      const delivered = await this.deliverReport(runId, log, {
        sale,
        subject: offer.subject,
        customer: offer.customer,
        price: offer.price_usd,
        ...(offerCheck ? { offerRef: offerCheck.id } : {}),
        payment: { deposit_address: pay?.deposit_address ?? "", intent_hashes: pay?.intent_hashes ?? [], near_tx_hashes: pay?.near_tx_hashes ?? [] },
      });
      if ("check" in delivered) return { status: "blocked", runId, entries, check: delivered.check };
      return { status: "completed", runId, entries, reportId: delivered.reportId };
    } catch (err) {
      if (err instanceof HaltError) {
        if (!entries.some((e) => e.type === "halt")) this.logHalt(log, err.stage, err.reason);
        return { status: "halted", runId, entries, stage: err.stage };
      }
      const msg = err instanceof Error ? err.message : String(err);
      log({ agent: "system", type: "error", result: "failed", summary: `Report retry stopped: ${msg}`, payload: { error: msg, sale: saleId } });
      return { status: "failed", runId, entries, error: msg };
    }
  }

  private async deliverReport(
    runId: string,
    log: Log,
    x: { sale: LedgerEntry; subject: string; customer: string; price: string; offerRef?: string; payment: NonNullable<Report["payment"]> },
  ): Promise<{ reportId: string } | { check: PolicyCheck }> {
    const sd = this.d.sales;
    const cfg = this.d.policy.config;
    if (!sd || !cfg.sales || !cfg.inference) throw new Error("report needs SaleDeps and the sales/inference config sections");
    this.guard("report", log);
    const reportId = `${runId}-report`;
    const tokens = await sd.oneclick.tokens();
    const facts = await gatherFacts(sd.rpc, cfg.verifier, x.subject, tokens);
    const model = sd.model ?? cfg.inference.approved_models[0]!;
    const ai = await meteredChat(
      { policy: this.d.policy, ledger: this.d.ledger, killSwitch: this.d.killSwitch, ai: sd.ai, append: (e) => log(e) },
      {
        runId,
        proposalId: `${runId}-ai`,
        agent: "analyst",
        purpose: `treasury report on ${x.subject}`,
        model,
        messages: reportPrompt(facts),
        maxTokens: sd.maxTokens ?? 2500,
        json: true,
        upstream: [x.sale.id],
      },
    );
    if (ai.kind === "blocked") return { check: ai.check };
    let analysis: ReturnType<typeof parseAnalysis>;
    try {
      analysis = parseAnalysis(ai.result.content);
    } catch (e) {
      const why = ai.result.finishReason === "length" ? `; the ${ai.result.completionTokens}-token output budget ran out` : "";
      throw new Error(`${e instanceof Error ? e.message : String(e)}${why} (model ${model}). Retry with --mode=report --sale=${x.sale.id}`);
    }
    const report: Report = {
      id: reportId,
      created_at: new Date().toISOString(),
      product: cfg.sales.product,
      subject: x.subject,
      customer: x.customer,
      price_usd: x.price,
      facts,
      analysis,
      model,
      cost_usd: (Number(ai.result.costMicros) / 1e6).toFixed(6),
      ledger: { sale: x.sale.id, cost: ai.costEntry.id, ...(x.offerRef ? { offer: x.offerRef } : {}) },
      payment: x.payment,
    };
    sd.reports.save(report);
    log({
      agent: "analyst",
      type: "report",
      result: "confirmed",
      summary: `Report delivered: "${analysis.headline}" (${x.subject}).`,
      upstream: [x.sale.id, ai.costEntry.id],
      payload: { report_id: reportId, subject: x.subject, model, cost_usd: report.cost_usd },
    });
    return { reportId };
  }

  /** Check a proposal that moves no value and log the result. */
  private async checkLogged(p: Proposal, log: Log, upstream: string[]): Promise<{ check: PolicyCheck; entry: LedgerEntry }> {
    this.guard("policy check", log);
    const state = deriveState(this.d.ledger.all(), {}, this.d.killSwitch.state().engaged);
    const check = this.d.policy.validate(p, state);
    const entry = log({
      agent: "policy",
      type: "policy_check",
      result: check.result,
      summary: check.summary,
      refs: { proposal_id: p.id },
      upstream,
      payload: { rules: check.rules, proposal_hash: check.proposalHash },
    });
    return { check, entry };
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
