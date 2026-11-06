"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LedgerEntry } from "@athera/ledger";
import { useStatus } from "../../components/shell/StatusProvider";
import { Button } from "../../components/ui/button";
import { StatusBadge as Badge } from "../../components/ui/status-badge";
import { Timeline, type Stage } from "../../components/ui/timeline";
import { SALE_STAGES, STAGES, isSaleRun, saleStageEntries, stageEntries, stagesFromRun } from "../../lib/stages";

type Mode = "loop" | "invalid" | "sale";

export interface SaleCost {
  product: string;
  price: string;
  asset: string;
  enabled: boolean;
}

function detail(e: LedgerEntry | undefined) {
  if (!e) return undefined;
  const r = e.refs ?? {};
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <Link href={`/ledger/${e.id}`} className="data inline-flex min-h-6 items-center underline underline-offset-4">
        {e.id}
      </Link>
      {r.intent_hash ? (
        <span className="data" title={r.intent_hash} translate="no">
          intent {r.intent_hash.slice(0, 6)}…{r.intent_hash.slice(-4)}
        </span>
      ) : null}
      {r.tx_hash ? (
        <a href={r.explorer?.[0]} target="_blank" rel="noreferrer" className="data inline-flex min-h-6 items-center underline underline-offset-4" title={r.tx_hash} translate="no">
          tx {r.tx_hash.slice(0, 6)}…{r.tx_hash.slice(-4)}
        </a>
      ) : null}
      {r.block_height ? <span className="data">block {r.block_height}</span> : null}
      {e.result === "block" ? <span className="text-destructive basis-full">{e.summary}</span> : null}
    </span>
  );
}

/**
 * Starts a real run on the server and draws the seven stages from ledger entries as they are
 * written. A stage changes only when its entry arrives through /api/stream: no timers, no
 * optimistic stages.
 */
export function DemoConsole({ lastRun, cost, sale }: { lastRun: LedgerEntry[]; cost: { principal: string; fee: string; total: string; vendor: string }; sale: SaleCost }) {
  const { live, operatorEnabled, token, onEntry, operatorFetch } = useStatus();
  const [runId, setRunId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const sawLock = useRef(false);
  // Real funds move on mainnet: the first click arms, the second (within 6s) starts.
  const [armed, setArmed] = useState<"loop" | "sale" | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 6000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setArmed(null);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [armed]);

  useEffect(
    () =>
      onEntry((e) => {
        setEntries((xs) => (runId && e.run_id.startsWith(runId) && !xs.some((x) => x.id === e.id) ? [...xs, e] : xs));
      }),
    [onEntry, runId],
  );

  // The run is over when its process releases the ledger lock (after we saw it hold it).
  if (runId && live.run?.runId === runId) sawLock.current = true;
  const finished = Boolean(runId && sawLock.current && live.run?.runId !== runId);
  const halted = live.killSwitch.engaged || live.killSwitch.configFlag;

  const main = useMemo(() => (runId ? entries.filter((e) => e.run_id === runId) : lastRun), [entries, runId, lastRun]);
  const reconciled = useMemo(() => (runId ? entries.filter((e) => e.run_id.startsWith(`${runId}c`)) : []), [entries, runId]);
  const isLive = Boolean(runId);
  const runFinished = isLive ? finished || main.some((e) => e.type === "halt" || e.type === "error") : true;
  const saleRun = isLive ? mode === "sale" : isSaleRun(main);
  const { stages } = stagesFromRun(main, runFinished, saleRun);
  const found = saleRun ? saleStageEntries(main) : stageEntries(main);
  const keys = saleRun ? SALE_STAGES : STAGES;
  const withDetail: Stage[] = stages.map((s, i) => ({ ...s, detail: detail(found[keys[i]!.key]) }));
  const reportId = (main.find((e) => e.type === "report")?.payload as { report_id?: string } | undefined)?.report_id;
  const current = withDetail.find((s) => s.status === "blocked" || s.status === "halted") ?? [...withDetail].reverse().find((s) => s.status === "done");
  const announce = current ? `${current.title}: ${current.status === "done" ? "done" : current.status}` : "";
  // Server timestamps only (first to last ledger entry of the run); the browser clock may be skewed.
  const elapsed = main.length > 1 ? ((Date.parse(main.at(-1)!.ts) - Date.parse(main[0]!.ts)) / 1000).toFixed(1) : null;

  async function start(m: Mode) {
    setError(null);
    setStarting(true);
    try {
      const res = await operatorFetch("/api/runs", { method: "POST", body: JSON.stringify({ mode: m }) });
      const b = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !b.runId) {
        setError(b.error ?? `Could not start (HTTP ${res.status}). Check the server log in data/runs/ and that the web server is running.`);
        return;
      }
      sawLock.current = false;
      setEntries([]);
      setMode(m);
      setRunId(b.runId);
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || Boolean(live.run) || halted;
  const locked = !operatorEnabled || !token;

  return (
    <div className="grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="default"
          onClick={() => {
            if (armed !== "sale") return setArmed("sale");
            setArmed(null);
            void start("sale");
          }}
          disabled={busy || locked || !sale.enabled}
          aria-describedby="run-cost"
        >
          {armed === "sale" ? `Confirm: pay ${sale.price} on mainnet` : "Sell a treasury report"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            if (armed !== "loop") return setArmed("loop");
            setArmed(null);
            void start("loop");
          }}
          disabled={busy || locked}
          aria-describedby="run-cost"
        >
          {armed === "loop" ? `Confirm: move ${cost.total} on mainnet` : "Run payment loop"}
        </Button>
        <Button variant="outline" className="text-destructive border-destructive/50 hover:text-destructive" onClick={() => start("invalid")} disabled={busy || locked}>
          Trigger invalid action
        </Button>
        <p className="text-muted-foreground basis-full text-sm" role="status" id="run-cost">
          {!operatorEnabled
            ? "Read-only deployment: runs can only be started on the server (pnpm demo)."
            : !token
              ? "Unlock operator controls with the kill switch control to start runs."
              : halted
                ? "Halted: release the kill switch on the server before starting a run."
                : live.run
                  ? `Run ${live.run.runId} is writing the ledger.`
                  : armed === "loop"
                    ? `Press again within 6 seconds to send ${cost.principal} to ${cost.vendor} and collect the ${cost.fee} fee on NEAR mainnet. Escape cancels.`
                    : armed === "sale"
                      ? `Press again within 6 seconds: the treasury pays ${sale.price} in ${sale.asset} through 1Click for a ${sale.product}, and one metered AI call writes it. Escape cancels.`
                      : `Selling a report: the treasury buys a ${sale.product} for ${sale.price}, paid through 1Click in ${sale.asset}; the revenue is split and an AI analyst writes the report.${sale.enabled ? "" : " (Needs NEARAI_API_KEY in the server's .env.)"} The payment loop moves ${cost.principal} to ${cost.vendor}. The invalid action is blocked before any intent exists.`}
        </p>
        {error ? (
          <p className="text-destructive basis-full text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid gap-1 border-t pt-5">
        <h2 className="text-xl font-semibold">{isLive ? (mode === "invalid" ? "Invalid action" : mode === "sale" ? "Report sale" : "Payment loop") : "Last run in the ledger"}</h2>
        <p className="text-muted-foreground text-sm">
          {main[0] ? (
            <>
              Run{" "}
              <Link href={`/ledger?run=${main[0].run_id}`} className="data">
                {main[0].run_id}
              </Link>
              {elapsed ? <span>, {elapsed}s from first to last entry</span> : null}
            </>
          ) : isLive ? (
            <>
              Run <span className="data">{runId}</span> started. Waiting for its first ledger entry…
            </>
          ) : (
            "No runs yet."
          )}
        </p>
        {isLive && runFinished ? (
          <p className="mt-1">
            {main.some((e) => e.type === "halt") ? (
              <Badge kind="halted" label="Halted by the kill switch" />
            ) : main.some((e) => e.result === "block") ? (
              <Badge kind="block" label="Blocked before any intent was created. Nothing was signed." />
            ) : main.some((e) => e.type === "error") ? (
              <Badge kind="failed" label="Stopped with an error; see the ledger" />
            ) : saleRun && reportId ? (
              <Badge kind="confirmed" label="Report delivered" />
            ) : !saleRun && main.some((e) => e.type === "payout") ? (
              <Badge kind="confirmed" label="Loop complete" />
            ) : null}
          </p>
        ) : null}
      </div>

      {reconciled.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          First, {reconciled.filter((e) => e.type === "fee").length} unfinished fee(s) from earlier halted runs were collected and split (
          <Link href={`/ledger?run=${reconciled[0]!.run_id}`}>see entries</Link>).
        </p>
      ) : null}

      {reportId ? (
        <p>
          <Link href={`/reports/${reportId}`} className="font-medium underline underline-offset-4">
            Read the report
          </Link>
        </p>
      ) : null}

      <Timeline label={saleRun ? "Sale stages" : "Loop stages"} stages={withDetail} announce={announce} live={isLive} />
    </div>
  );
}
