import type { LedgerEntry } from "@athera/ledger";
import type { StatusKind as BadgeKind } from "../components/ui/status-badge";

/**
 * How to show an entry's result. Ledger entries are immutable, so an intent entry written as
 * "pending" stays pending in the file forever; the display resolves it against the settlement
 * entry that followed it (if any). Nothing is inferred beyond what the ledger records.
 */
export function displayResult(e: LedgerEntry, all: readonly LedgerEntry[]): { kind: BadgeKind; label?: string; resolvedBy?: string } {
  if (e.type === "intent_created" || e.type === "intent_submitted") {
    const downstream = (id: string) => all.find((x) => x.upstream?.includes(id));
    const submitted = e.type === "intent_created" ? downstream(e.id) : e;
    const settlement = submitted ? downstream(submitted.id) : undefined;
    if (settlement?.type === "settlement" && settlement.result === "confirmed") return { kind: "confirmed", label: "Settled", resolvedBy: settlement.id };
    if (settlement?.type === "settlement" && settlement.result === "failed") return { kind: "failed", resolvedBy: settlement.id };
    if (all.some((x) => x.type === "halt" && x.run_id === e.run_id && x.seq > e.seq) && !settlement) return { kind: "halted", label: "Halted, unsettled" };
    return { kind: "pending" };
  }
  if (e.result === "info") return { kind: "info" };
  return { kind: e.result };
}
