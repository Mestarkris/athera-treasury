import type { LedgerEntry } from "@athera/ledger";
import type { Stage } from "../components/ui/timeline";

/** The seven stages of one loop, in order (brief). */
export const STAGES = [
  { key: "proposal", title: "Treasury proposes" },
  { key: "policy", title: "Policy check" },
  { key: "created", title: "Intent created" },
  { key: "submitted", title: "Intent submitted" },
  { key: "settled", title: "Settlement confirmed" },
  { key: "fee", title: "Fee collected" },
  { key: "split", title: "Revenue split paid" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

/**
 * Map a run's ledger entries onto the seven stages. Only entries that exist produce "done";
 * nothing is inferred. `finished` = the run is over, so unreached stages read "Not reached".
 */
export function stageEntries(run: readonly LedgerEntry[]): Partial<Record<StageKey, LedgerEntry>> {
  const out: Partial<Record<StageKey, LedgerEntry>> = {};
  // Principal leg = everything before the first fee proposal.
  const feeStart = run.findIndex((e) => e.type === "proposal" && (e.payload as { kind?: string } | undefined)?.kind === "fee");
  const principal = feeStart === -1 ? run : run.slice(0, feeStart);
  const first = (t: LedgerEntry["type"]) => principal.find((e) => e.type === t);
  const set = (k: StageKey, e: LedgerEntry | undefined) => {
    if (e) out[k] = e;
  };
  set("proposal", first("proposal"));
  set("policy", first("policy_check"));
  set("created", first("intent_created"));
  set("submitted", first("intent_submitted"));
  set("settled", principal.find((e) => e.type === "settlement" && e.result === "confirmed"));
  set("fee", run.find((e) => e.type === "fee"));
  set("split", [...run].reverse().find((e) => e.type === "payout"));
  return out;
}

export function stagesFromRun(run: readonly LedgerEntry[], finished: boolean): { stages: Stage[]; halt?: LedgerEntry } {
  const found = stageEntries(run);
  const halt = run.find((e) => e.type === "halt");
  let stopped = false;
  const stages: Stage[] = STAGES.map(({ key, title }) => {
    const e = found[key];
    if (stopped) return { key, title, status: "skipped" };
    if (!e) {
      stopped = finished || Boolean(halt);
      return { key, title, status: halt ? "halted" : finished ? "skipped" : "waiting" };
    }
    if (e.result === "block" || e.result === "failed") {
      stopped = true;
      return { key, title, status: "blocked", at: e.ts.slice(11, 19) };
    }
    return { key, title, status: e.result === "pending" && key !== "created" && key !== "submitted" ? "active" : "done", at: e.ts.slice(11, 19) };
  });
  return halt ? { stages, halt } : { stages };
}
