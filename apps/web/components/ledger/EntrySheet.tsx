"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LedgerEntry } from "@athera/ledger";
import { buttonVariants } from "../ui/button";
import { Hash } from "../ui/hash";
import { Sheet } from "../ui/sheet";
import { StatusBadge } from "../ui/status-badge";
import { displayResult } from "../../lib/display";
import { eventLabel } from "./labels";

type Detail = { entry: LedgerEntry; upstream: LedgerEntry[]; downstream: LedgerEntry[] };

/** The entry sheet itself. Loaded on first use by EntrySheetHost; data from /api/ledger/:id. */
export default function EntrySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    setData(null);
    setError(null);
    fetch(`/api/ledger/${id}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Detail>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "could not load");
      });
    return () => ctrl.abort();
  }, [id]);

  const e = data?.entry;
  const result = e ? displayResult(e, [e, ...(data?.downstream ?? [])]) : null;
  return (
    <Sheet open={id !== null} onClose={onClose} title={e ? `Entry ${String(e.seq).padStart(4, "0")}: ${eventLabel(e.type)}` : "Ledger entry"}>
      {error ? <p className="text-destructive text-sm">Could not load this entry ({error}).</p> : null}
      {!e && !error ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {e && result ? (
        <div className="grid gap-3">
          <p className={e.result === "block" ? "border-destructive border-l-2 pl-3" : undefined}>{e.summary}</p>
          <StatusBadge kind={result.kind} label={result.label} />
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-muted-foreground">
            <dt>Time</dt>
            <dd className="data">{e.ts.replace("T", " ").slice(0, 19)} UTC</dd>
            <dt>Agent</dt>
            <dd>{e.agent}</dd>
            {e.amount ? (
              <>
                <dt>Amount</dt>
                <dd className="data">{e.amount.display}</dd>
              </>
            ) : null}
            <dt>Policy</dt>
            <dd className="data">
              v{e.policy.version} · {e.policy.hash.slice(0, 6)}
            </dd>
            {e.refs?.tx_hash ? (
              <>
                <dt>Transaction</dt>
                <dd>
                  <Hash value={e.refs.tx_hash} href={e.refs.explorer?.[0]} label="transaction" />
                </dd>
              </>
            ) : null}
            {e.refs?.intent_hash ? (
              <>
                <dt>Intent</dt>
                <dd>
                  <Hash value={e.refs.intent_hash} label="intent hash" />
                </dd>
              </>
            ) : null}
          </dl>
          <Link href={`/ledger/${e.id}`} className={buttonVariants({ variant: "outline", className: "mt-1 justify-self-start" })}>
            Open full entry: rules, before and after, how to verify
          </Link>
        </div>
      ) : null}
    </Sheet>
  );
}
