import { base58 } from "@scure/base";
import { HaltError, hashJson, isMintedCheck, type KillSwitch, type PassedPolicyCheck, type PolicyEngine, type Proposal } from "@athera/policy";
import type { Chain } from "./chain.ts";
import { nep413Prehash, toSignedJson, versionedNonce, type Nep413Payload, type SignedNep413Json } from "./intents/nep413.ts";
import type { ExecutionOutcome } from "./near/rpc.ts";
import { signTx } from "./near/tx.ts";
import type { IntentSigner, TxSigner } from "./signer.ts";

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class SettlementError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "SettlementError";
  }
}

export interface TransferIntentJson {
  intent: "transfer";
  receiver_id: string;
  tokens: Record<string, string>;
  memo: string;
}

export interface CreatedIntent {
  readonly proposalId: string;
  readonly signerId: string;
  /** base58 NEP-413 prehash; intents.near emits it as `intent_hash`. */
  readonly intentHash: string;
  readonly memo: string;
  readonly intents: readonly TransferIntentJson[];
  readonly deadline: string;
  readonly payload: Nep413Payload;
  readonly check: PassedPolicyCheck;
}

export interface SubmittedIntent extends CreatedIntent {
  readonly txHash: string;
  readonly submitter: string;
  readonly signed: SignedNep413Json;
}

export interface Dip4Event {
  readonly event: string;
  readonly data: readonly Record<string, unknown>[];
}

export interface SettledIntent extends SubmittedIntent {
  readonly blockHash: string;
  readonly blockHeight: number;
  readonly receiptId: string;
  readonly events: readonly Dip4Event[];
}

export interface SettlementDeps {
  readonly chain: Chain;
  readonly policy: PolicyEngine;
  readonly killSwitch: KillSwitch;
  readonly intentSigners: readonly IntentSigner[];
  readonly submitter: TxSigner;
  readonly maxCheckAgeMs?: number;
  readonly deadlineMs?: number;
  readonly gas?: bigint;
  readonly now?: () => Date;
}

/** `athera:<proposal id>:<policy hash 8>`. Written on-chain in every transfer intent. */
export const memoFor = (p: Proposal, policyHash: string) => `athera:${p.id}:${policyHash.slice(0, 8)}`;

/**
 * Creates, signs, submits and tracks NEAR Intents. It cannot decide strategy and cannot
 * change limits: its only input is a PassedPolicyCheck minted by the PolicyEngine, which it
 * re-verifies (and re-checks the kill switch) before creating, before signing and before
 * broadcasting.
 */
export class Settlement {
  private readonly signers: Map<string, IntentSigner>;
  private readonly used = new Set<string>();
  private readonly d: Required<Omit<SettlementDeps, "intentSigners">>;

  constructor(deps: SettlementDeps) {
    this.signers = new Map(deps.intentSigners.map((s) => [s.accountId, s]));
    this.d = {
      maxCheckAgeMs: 60_000,
      deadlineMs: 120_000,
      gas: 100_000_000_000_000n,
      now: () => new Date(),
      ...deps,
    };
  }

  get verifier(): string {
    return this.d.policy.config.verifier;
  }

  /** Throws unless `check` is a genuine, fresh, unused pass for the current policy and nothing is halted. */
  authorize(check: PassedPolicyCheck, stage: string): void {
    const ks = this.d.killSwitch.state();
    if (ks.engaged) throw new HaltError(stage, ks.reason ?? "kill switch engaged");
    if (this.d.policy.config.kill_switch) throw new HaltError(stage, "kill_switch: true in config.yaml");
    if (!isMintedCheck(check)) throw new AuthorizationError(`${stage}: check was not issued by the PolicyEngine`);
    if (check.result !== "pass") throw new AuthorizationError(`${stage}: check did not pass`);
    if (hashJson(check.proposal) !== check.proposalHash) throw new AuthorizationError(`${stage}: proposal changed after its policy check`);
    if (check.policy.hash !== this.d.policy.ref.hash) throw new AuthorizationError(`${stage}: policy changed since the check`);
    const age = this.d.now().getTime() - Date.parse(check.checkedAt);
    if (age > this.d.maxCheckAgeMs) throw new AuthorizationError(`${stage}: policy check is ${age} ms old (max ${this.d.maxCheckAgeMs})`);
    if (check.proposal.protocol !== this.verifier) throw new AuthorizationError(`${stage}: proposal targets ${check.proposal.protocol}, not ${this.verifier}`);
    if (!this.signers.has(check.proposal.from)) throw new AuthorizationError(`${stage}: no custody for ${check.proposal.from}`);
  }

  /** Build the intent and its hash. Nothing is signed here. */
  async create(check: PassedPolicyCheck): Promise<CreatedIntent> {
    this.authorize(check, "intent creation");
    if (this.used.has(check.proposalHash)) throw new AuthorizationError("this policy check was already used");
    const p = check.proposal;
    if (p.kind === "inference_spend" || p.kind === "sale_offer" || p.legs.length === 0) {
      throw new SettlementError(`${p.kind} moves no value; nothing to settle`);
    }

    const memo = memoFor(p, check.policy.hash);
    const intents: TransferIntentJson[] = p.legs.map((l) => ({
      intent: "transfer",
      receiver_id: l.to,
      tokens: { [l.asset]: l.amount },
      memo,
    }));
    const deadline = new Date(this.d.now().getTime() + this.d.deadlineMs);
    const salt = await this.d.chain.currentSalt(this.verifier);
    const message = JSON.stringify({ signer_id: p.from, deadline: deadline.toISOString(), intents });
    const payload: Nep413Payload = { message, nonce: versionedNonce(salt, deadline), recipient: this.verifier };
    this.used.add(check.proposalHash);

    return Object.freeze({
      proposalId: p.id,
      signerId: p.from,
      intentHash: base58.encode(nep413Prehash(payload)),
      memo,
      intents,
      deadline: deadline.toISOString(),
      payload,
      check,
    });
  }

  /** Sign the intent, dry-run it on the verifier, then submit `execute_intents`. */
  async submit(created: CreatedIntent): Promise<SubmittedIntent> {
    this.authorize(created.check, "signing");
    const signer = this.signers.get(created.signerId);
    if (!signer) throw new AuthorizationError(`no custody for ${created.signerId}`);

    const digest = nep413Prehash(created.payload);
    if (base58.encode(digest) !== created.intentHash) throw new AuthorizationError("intent payload changed after creation");
    const signed = toSignedJson(created.payload, signer.publicKey, signer.sign(digest));

    // Dry run: catches unregistered keys, bad signatures and insufficient balance before gas is spent.
    await this.d.chain.simulate(this.verifier, [signed]).catch((e: unknown) => {
      throw new SettlementError(`simulate_intents rejected the intent: ${e instanceof Error ? e.message : String(e)}`, e);
    });

    this.authorize(created.check, "submission");
    const sub = this.d.submitter;
    const { nonce, blockHash } = await this.d.chain.accessKeyNonce(sub.accountId, sub.key.publicKey);
    const tx = signTx(
      {
        signerId: sub.accountId,
        publicKeyRaw: sub.key.publicKeyRaw,
        nonce: nonce + 1n,
        receiverId: this.verifier,
        blockHash,
        methodName: "execute_intents",
        args: { signed: [signed] },
        gas: this.d.gas,
        deposit: 0n,
      },
      sub.key,
    );
    await this.d.chain.broadcast(tx.base64);
    return Object.freeze({ ...created, txHash: tx.hash, submitter: sub.accountId, signed });
  }

  /** Wait for finality and confirm the verifier emitted events carrying our intent hash. */
  async track(sub: SubmittedIntent): Promise<SettledIntent> {
    const res = await this.d.chain.txStatus(sub.txHash, sub.submitter);
    const failed = [res.transaction_outcome, ...res.receipts_outcome].find((o) => isFailure(o));
    if (isFailureStatus(res.status) || failed) {
      throw new SettlementError(`transaction ${sub.txHash} failed on-chain`, failed?.outcome.status ?? res.status);
    }
    const events: Dip4Event[] = [];
    let receipt: ExecutionOutcome | undefined;
    for (const o of res.receipts_outcome) {
      for (const log of o.outcome.logs) {
        const ev = parseDip4(log);
        if (ev && ev.data.some((d) => d["intent_hash"] === sub.intentHash)) {
          events.push(ev);
          receipt ??= o;
        }
      }
    }
    if (!receipt) throw new SettlementError(`no verifier event carries intent_hash ${sub.intentHash}`, res.receipts_outcome);
    const blockHeight = await this.d.chain.blockHeight(receipt.block_hash);
    return Object.freeze({ ...sub, blockHash: receipt.block_hash, blockHeight, receiptId: receipt.id, events });
  }
}

function isFailureStatus(s: unknown): boolean {
  return typeof s === "object" && s !== null && "Failure" in s;
}
const isFailure = (o: ExecutionOutcome) => isFailureStatus(o.outcome.status);

export function parseDip4(log: string): Dip4Event | undefined {
  if (!log.startsWith("EVENT_JSON:")) return undefined;
  try {
    const v = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard?: unknown; event?: unknown; data?: unknown };
    if (v.standard !== "dip4" || typeof v.event !== "string") return undefined;
    const data = Array.isArray(v.data) ? v.data : v.data && typeof v.data === "object" ? [v.data] : [];
    return { event: v.event, data: data as Record<string, unknown>[] };
  } catch {
    return undefined;
  }
}
