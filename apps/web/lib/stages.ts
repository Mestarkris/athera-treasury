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

/** The stages of one sale: offer → quote → payment → swap → split → AI report. */
export const SALE_STAGES = [
  { key: "offer", title: "Sales offers a report" },
  { key: "offer_check", title: "Price check" },
  { key: "quote", title: "1Click quote" },
  { key: "pay_check", title: "Payment check" },
  { key: "paid", title: "Payment intent settled" },
  { key: "sale", title: "USDC received" },
  { key: "split", title: "Revenue split paid" },
  { key: "ai", title: "AI call checked and costed" },
  { key: "report", title: "Report delivered" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"] | (typeof SALE_STAGES)[number]["key"];

/** A sale run starts with a sale_offer proposal. */
export const isSaleRun = (run: readonly LedgerEntry[]) =>
  run.some((e) => e.type === "proposal" && (e.payload as { kind?: string } | undefined)?.kind === "sale_offer");

export function saleStageEntries(run: readonly LedgerEntry[]): Partial<Record<StageKey, LedgerEntry>> {
  const out: Partial<Record<StageKey, LedgerEntry>> = {};
  const set = (k: StageKey, e: LedgerEntry | undefined) => {
    if (e) out[k] = e;
  };
  const kindOf = (e: LedgerEntry) => (e.payload as { kind?: string } | undefined)?.kind;
  const checkAfter = (id: string | undefined) => (id ? run.find((e) => e.type === "policy_check" && e.upstream?.includes(id)) : undefined);
  const offer = run.find((e) => e.type === "proposal" && kindOf(e) === "sale_offer");
  set("offer", offer);
  set("offer_check", checkAfter(offer?.id));
  set("quote", run.find((e) => e.type === "quote"));
  const purchase = run.find((e) => e.type === "proposal" && kindOf(e) === "service_purchase");
  set("pay_check", checkAfter(purchase?.id));
  const saleEntry = run.find((e) => e.type === "sale");
  const splitStart = run.findIndex((e) => e.type === "proposal" && kindOf(e) === "revenue_split");
  const beforeSplit = splitStart === -1 ? run : run.slice(0, splitStart);
  set("paid", beforeSplit.find((e) => e.type === "settlement"));
  set("sale", saleEntry);
  set("split", [...run].reverse().find((e) => e.type === "payout"));
  // The report's own AI call (the last one); an earlier one may be the pre-payment availability check.
  set("ai", [...run].reverse().find((e) => e.type === "cost") ?? run.find((e) => e.type === "policy_check" && (e.payload as { proposal?: { kind?: string } } | undefined)?.proposal?.kind === "inference_spend"));
  set("report", run.find((e) => e.type === "report"));
  return out;
}

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

export function stagesFromRun(run: readonly LedgerEntry[], finished: boolean, sale = isSaleRun(run)): { stages: Stage[]; halt?: LedgerEntry } {
  const found = sale ? saleStageEntries(run) : stageEntries(run);
  const list: readonly { key: StageKey; title: string }[] = sale ? SALE_STAGES : STAGES;
  const halt = run.find((e) => e.type === "halt");
  let stopped = false;
  const stages: Stage[] = list.map(({ key, title }) => {
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
