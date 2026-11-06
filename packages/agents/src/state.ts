import type { LedgerEntry } from "@athera/ledger";
import { key, type PolicyState, type TransferLeg } from "@athera/policy";

/** Payload Settlement-stage ledger entries carry so state can be rebuilt from the ledger alone. */
export interface MovementPayload {
  readonly kind: string;
  readonly from: string;
  readonly legs: readonly TransferLeg[];
  readonly basis_ref?: string;
}

const isMovement = (p: unknown): p is MovementPayload =>
  typeof p === "object" && p !== null && "from" in p && "legs" in p && Array.isArray((p as MovementPayload).legs);

const sameUtcDay = (a: string, b: Date) => a.slice(0, 10) === b.toISOString().slice(0, 10);

/**
 * Rebuild policy state from the public ledger plus live balances. Every submitted intent
 * counts toward today's outflow unless the ledger later records its settlement as failed.
 */
export function deriveState(entries: readonly LedgerEntry[], balances: Record<string, bigint>, halted: boolean, now = new Date()): PolicyState {
  const failed = new Set(entries.filter((e) => e.type === "settlement" && e.result === "failed").map((e) => e.refs?.intent_hash));
  const movedToday: Record<string, bigint> = {};
  const feeChargedFor = new Set<string>();
  const splitDoneFor = new Set<string>();
  const peakToday: Record<string, bigint> = { ...balances };
  let inferenceTodayMicros = 0n;

  for (const e of entries) {
    if (!sameUtcDay(e.ts, now)) continue;
    if (e.type === "intent_submitted" && isMovement(e.payload) && !failed.has(e.refs?.intent_hash)) {
      for (const l of e.payload.legs) {
        const k = key(e.payload.from, l.asset);
        movedToday[k] = (movedToday[k] ?? 0n) + BigInt(l.amount);
      }
      if (e.payload.basis_ref && e.payload.kind === "fee") feeChargedFor.add(e.payload.basis_ref);
      if (e.payload.basis_ref && e.payload.kind === "revenue_split") splitDoneFor.add(e.payload.basis_ref);
    }
    // Actual AI inference cost recorded today (cost entries carry the billed micro-USD).
    if (e.type === "cost" && typeof e.payload === "object" && e.payload && "usd_micros" in e.payload) {
      inferenceTodayMicros += BigInt(String((e.payload as { usd_micros: unknown }).usd_micros));
    }
    if (e.type === "policy_check" && typeof e.payload === "object" && e.payload && "balances" in e.payload) {
      const snap = (e.payload as { balances: Record<string, string> }).balances;
      for (const [k, v] of Object.entries(snap)) {
        const b = BigInt(v);
        if (b > (peakToday[k] ?? 0n)) peakToday[k] = b;
      }
    }
  }

  return { now, halted, movedToday, inferenceTodayMicros, balances, peakToday, feeChargedFor, splitDoneFor };
}

/**
 * From the ledger alone: confirmed principal settlements (transfer / vendor_payment) that have no
 * fee intent yet, and confirmed fees that have no split intent yet. Oldest first.
 */
export function pendingAccounting(entries: readonly LedgerEntry[]): {
  principals: { ref: string; asset: string; amount: string }[];
  fees: { ref: string; asset: string; amount: string }[];
} {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const failed = new Set(entries.filter((e) => e.type === "settlement" && e.result === "failed").map((e) => e.refs?.intent_hash));
  const based = (kind: string) =>
    new Set(
      entries
        .filter((e) => e.type === "intent_submitted" && isMovement(e.payload) && e.payload.kind === kind && !failed.has(e.refs?.intent_hash))
        .map((e) => (e.payload as MovementPayload).basis_ref),
    );
  const feeFor = based("fee");
  const splitFor = based("revenue_split");

  const principals: { ref: string; asset: string; amount: string }[] = [];
  for (const e of entries) {
    if (e.type !== "settlement" || e.result !== "confirmed") continue;
    const submitted = byId.get(e.upstream?.[0] ?? "");
    const mv = submitted?.payload;
    if (!isMovement(mv) || (mv.kind !== "transfer" && mv.kind !== "vendor_payment") || feeFor.has(e.id)) continue;
    const leg = mv.legs[0];
    if (leg && mv.legs.every((l) => l.asset === leg.asset)) {
      principals.push({ ref: e.id, asset: leg.asset, amount: mv.legs.reduce((s, l) => s + BigInt(l.amount), 0n).toString() });
    }
  }
  const fees = entries
    .filter((e) => (e.type === "fee" || e.type === "sale") && e.result === "confirmed" && !splitFor.has(e.id) && e.amount)
    .map((e) => ({ ref: e.id, asset: e.amount!.asset, amount: e.amount!.value }));
  return { principals, fees };
}
