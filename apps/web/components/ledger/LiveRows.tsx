"use client";

import { useEffect, useState } from "react";
import type { LedgerEntry } from "@athera/ledger";
import { useStatus } from "../shell/StatusProvider";
import { LedgerRow } from "./LedgerTable";

/**
 * Rows appended to the ledger after this page was rendered, newest first, in their own <tbody>
 * above the server-rendered rows. Each batch slides in with a 35ms stagger and a fading
 * highlight. Filters apply to live rows too. Nothing here is invented: each row is a line the
 * server just read from the ledger file.
 */
export function LiveRows({ afterSeq, type, agent }: { afterSeq: number; type?: string | undefined; agent?: string | undefined }) {
  const { onEntry } = useStatus();
  const [rows, setRows] = useState<{ e: LedgerEntry; batchIndex: number }[]>([]);

  useEffect(() => {
    let batch = 0;
    let batchTimer: ReturnType<typeof setTimeout> | undefined;
    const off = onEntry((e) => {
      if (e.seq <= afterSeq) return;
      if (type && e.type !== type) return;
      if (agent && e.agent !== agent) return;
      // Entries arriving within 300ms of each other form one staggered batch.
      clearTimeout(batchTimer);
      batchTimer = setTimeout(() => (batch = 0), 300);
      const i = batch++;
      setRows((r) => (r.some((x) => x.e.id === e.id) ? r : [{ e, batchIndex: i }, ...r]));
    });
    return () => {
      off();
      clearTimeout(batchTimer);
    };
  }, [onEntry, afterSeq, type, agent]);

  if (rows.length === 0) return null;
  // Status resolution only needs the live rows themselves: a settlement always arrives after
  // its intent, and each new arrival re-renders the batch. (Not serializing the whole ledger.)
  const known = rows.map((r) => r.e);
  return (
    <tbody role="rowgroup" aria-live="polite" aria-label="New entries">
      {rows.map(({ e, batchIndex }) => (
        <LedgerRow key={e.id} e={e} all={known} fresh index={Math.min(batchIndex, 8)} />
      ))}
    </tbody>
  );
}
