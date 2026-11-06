import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { LedgerEntry } from "@athera/ledger";
import { Badge } from "../ui/badge";
import { StatusBadge } from "../ui/status-badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { displayResult } from "../../lib/display";
import { cn } from "../../lib/utils";
import { EntryLink } from "./EntryLink";
import { eventLabel } from "./labels";
import styles from "./ledger.module.css";

export { eventLabel };

export function LedgerHead() {
  return (
    <TableHeader role="rowgroup" className={styles.head}>
      <TableRow role="row" className="hover:bg-transparent">
        <TableHead role="columnheader" className="text-right">Seq</TableHead>
        <TableHead role="columnheader" className="text-right">Time (UTC)</TableHead>
        <TableHead role="columnheader">Agent</TableHead>
        <TableHead role="columnheader">Event</TableHead>
        <TableHead role="columnheader" className="text-right">Amount</TableHead>
        <TableHead role="columnheader">Policy</TableHead>
        <TableHead role="columnheader">Result</TableHead>
        <TableHead role="columnheader">Verify</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** One ledger row. Every row carries its policy hash and a verify link (or says why there is none). */
export function LedgerRow({ e, all, fresh, index }: { e: LedgerEntry; all: readonly LedgerEntry[]; fresh?: boolean; index?: number }) {
  const result = displayResult(e, all);
  const explorer = e.refs?.explorer?.[0];
  const blocked = e.result === "block";
  return (
    <TableRow
      id={e.id}
      role="row"
      data-blocked={blocked}
      className={cn(blocked && "[&>td:first-child]:shadow-[inset_2px_0_0_var(--block-dot)]", fresh && styles.fresh)}
      style={index !== undefined ? ({ "--i": index } as CSSProperties) : undefined}
    >
      <TableCell role="cell" className={cn("data text-muted-foreground text-right", styles.cSeq)} translate="no">
        <a href={`#${e.id}`} title={`Link to this row (entry ${e.seq})`} className="hover:text-foreground">
          {String(e.seq).padStart(4, "0")}
        </a>
      </TableCell>
      <TableCell role="cell" className={cn("num text-right", styles.cTime)} translate="no">
        {e.ts.slice(11, 19)}
      </TableCell>
      <TableCell role="cell" className={styles.cAgent}>
        <Badge variant="secondary">{e.agent}</Badge>
      </TableCell>
      <TableCell role="cell" className={cn("font-medium [&_a]:underline-offset-4 [&_a:hover]:underline", styles.cEvent)}>
        <EntryLink id={e.id} label={eventLabel(e.type)} />
      </TableCell>
      <TableCell role="cell" className={cn("num text-right", styles.cAmount)} translate="no">
        {e.amount?.display ?? ""}
      </TableCell>
      <TableCell role="cell" className={cn("data text-muted-foreground", styles.cPolicy)} translate="no">
        v{e.policy.version} · {e.policy.hash.slice(0, 6)}
      </TableCell>
      <TableCell role="cell" className={styles.cResult}>
        <StatusBadge kind={result.kind} label={result.label} />
      </TableCell>
      <TableCell role="cell" className={cn("text-sm", styles.cVerify)}>
        {explorer ? (
          <a href={explorer} target="_blank" rel="noreferrer" className="underline underline-offset-4" aria-label={`nearblocks, verify entry ${e.seq} (opens in new tab)`}>
            nearblocks
          </a>
        ) : (
          <Link href={`/ledger/${e.id}#verify`} className="text-muted-foreground text-xs underline underline-offset-4">
            {blocked ? "nothing on-chain" : "off-chain"}
          </Link>
        )}
      </TableCell>
    </TableRow>
  );
}

export function LedgerTable({ caption, entries, all, live }: { caption: string; entries: readonly LedgerEntry[]; all: readonly LedgerEntry[]; live?: ReactNode }) {
  return (
    <div className={styles.ledger}>
      <Table label={caption} role="table">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <LedgerHead />
        {live}
        <TableBody role="rowgroup">
          {entries.map((e) => (
            <LedgerRow key={e.id} e={e} all={all} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
