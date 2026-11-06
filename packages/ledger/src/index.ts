import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson, sha256Hex, type PolicyRef } from "@athera/policy";

export type LedgerAgent = "policy" | "treasury" | "settlement" | "accounting" | "procurement" | "sales" | "analyst" | "operator" | "system";

export type LedgerEventType =
  | "policy_check"
  | "proposal"
  | "intent_created"
  | "intent_submitted"
  | "settlement"
  | "fee"
  | "payout"
  | "cost"
  | "quote"
  | "sale"
  | "report"
  | "halt"
  | "error";

export type LedgerResult = "pass" | "block" | "pending" | "confirmed" | "failed" | "halted" | "info";

export interface LedgerAmount {
  readonly asset: string;
  /** Base units, integer string. */
  readonly value: string;
  /** Human form, e.g. "0.01 wNEAR". */
  readonly display: string;
}

/** Anything a reviewer can use to match this entry against the chain without our logs. */
export interface LedgerRefs {
  readonly proposal_id?: string;
  /** base58 NEP-413 prehash, emitted by intents.near as `intent_hash` in dip4 events. */
  readonly intent_hash?: string;
  readonly tx_hash?: string;
  readonly signer_id?: string;
  readonly block_hash?: string;
  readonly block_height?: number;
  /** Memo written into the on-chain transfer intent, e.g. `athera:<proposal_id>`. */
  readonly memo?: string;
  readonly explorer?: readonly string[];
}

export interface LedgerEntryInput {
  readonly run_id: string;
  readonly agent: LedgerAgent;
  readonly type: LedgerEventType;
  readonly result: LedgerResult;
  /** One plain sentence. */
  readonly summary: string;
  readonly policy: PolicyRef;
  readonly amount?: LedgerAmount;
  readonly refs?: LedgerRefs;
  /** Ledger ids of the entries this one follows from. */
  readonly upstream?: readonly string[];
  readonly payload?: unknown;
}

export interface LedgerEntry extends LedgerEntryInput {
  /** First 16 hex chars of `hash`. Stable, URL-safe. */
  readonly id: string;
  readonly seq: number;
  readonly ts: string;
  readonly prev_hash: string;
  /** SHA-256 over canonical JSON of every other field (except id). */
  readonly hash: string;
}

export const GENESIS = "0".repeat(64);

export function hashEntry(e: Omit<LedgerEntry, "id" | "hash">): string {
  return sha256Hex(canonicalJson(e));
}

/** Recompute every hash and link. Returns the first broken seq, or null if the chain is intact. */
export function verifyChain(entries: readonly LedgerEntry[]): { ok: true } | { ok: false; seq: number; reason: string } {
  let prev = GENESIS;
  for (const [i, e] of entries.entries()) {
    const { id, hash, ...rest } = e;
    if (e.seq !== i) return { ok: false, seq: e.seq, reason: "sequence gap" };
    if (e.prev_hash !== prev) return { ok: false, seq: e.seq, reason: "prev_hash does not link" };
    const h = hashEntry(rest);
    if (h !== hash) return { ok: false, seq: e.seq, reason: "hash mismatch" };
    if (id !== hash.slice(0, 16)) return { ok: false, seq: e.seq, reason: "id mismatch" };
    prev = hash;
  }
  return { ok: true };
}

export interface Ledger {
  append(input: LedgerEntryInput): LedgerEntry;
  all(): readonly LedgerEntry[];
  get(id: string): LedgerEntry | undefined;
  subscribe(fn: (e: LedgerEntry) => void): () => void;
}

abstract class BaseLedger implements Ledger {
  protected entries: LedgerEntry[] = [];
  private listeners = new Set<(e: LedgerEntry) => void>();

  protected abstract persist(e: LedgerEntry): void;

  append(input: LedgerEntryInput): LedgerEntry {
    const prev = this.entries.at(-1);
    const body = {
      ...structuredClone(input),
      seq: this.entries.length,
      ts: new Date().toISOString(),
      prev_hash: prev?.hash ?? GENESIS,
    };
    // Round-trip through canonical JSON so what we hash is exactly what we store.
    const normalized = JSON.parse(canonicalJson(body)) as Omit<LedgerEntry, "id" | "hash">;
    const hash = hashEntry(normalized);
    const entry: LedgerEntry = Object.freeze({ ...normalized, hash, id: hash.slice(0, 16) });
    this.persist(entry);
    this.entries.push(entry);
    for (const l of this.listeners) l(entry);
    return entry;
  }

  all(): readonly LedgerEntry[] {
    return this.entries;
  }

  get(id: string): LedgerEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  subscribe(fn: (e: LedgerEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export class MemoryLedger extends BaseLedger {
  protected persist(): void {}
}

/** Append-only JSON Lines file. Opened with O_APPEND; existing lines are never rewritten. */
export class FileLedger extends BaseLedger {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) {
      this.entries = readLedgerFile(path);
      const v = verifyChain(this.entries);
      if (!v.ok) throw new Error(`ledger ${path} is corrupt at seq ${v.seq}: ${v.reason}`);
    } else {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  protected persist(e: LedgerEntry): void {
    appendFileSync(this.path, `${canonicalJson(e)}\n`, { flag: "a" });
  }
}

export function readLedgerFile(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerEntry);
}

export const nearblocksTx = (txHash: string) => `https://nearblocks.io/txns/${txHash}`;
