import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { LedgerEntry } from "@athera/ledger";
import { Badge } from "../ui/Badge";
import { Row, Table, Td, Th } from "../ui/Table";
import { displayResult } from "../../lib/display";
import { EntryLink } from "./EntryLink";
import { eventLabel } from "./labels";
import styles from "./ledger.module.css";

export { eventLabel };

const H = { role: "columnheader" } as const;
const C = { role: "cell" } as const;

export function LedgerHead() {
  return (
    <thead role="rowgroup" className={styles.head}>
      <tr role="row">
        <Th numeric {...H}>Seq</Th>
        <Th numeric {...H}>Time (UTC)</Th>
        <Th {...H}>Agent</Th>
        <Th {...H}>Event</Th>
        <Th numeric {...H}>Amount</Th>
        <Th {...H}>Policy</Th>
        <Th {...H}>Result</Th>
        <Th {...H}>Verify</Th>
      </tr>
    </thead>
  );
}

/** One ledger row. Every row carries its policy hash and a verify link (or says why there is none). */
export function LedgerRow({ e, all, fresh, index }: { e: LedgerEntry; all: readonly LedgerEntry[]; fresh?: boolean; index?: number }) {
  const result = displayResult(e, all);
  const explorer = e.refs?.explorer?.[0];
  return (
    <Row
      id={e.id}
      role="row"
      blocked={e.result === "block"}
      data-blocked={e.result === "block"}
      className={fresh ? styles.fresh : undefined}
      style={index !== undefined ? ({ "--i": index } as CSSProperties) : undefined}
    >
      <Td numeric {...C} className={styles.cSeq}>
        <a href={`#${e.id}`} className={styles.seq} title={`Link to this row (entry ${e.seq})`}>
          {String(e.seq).padStart(4, "0")}
        </a>
      </Td>
      <Td numeric {...C} className={styles.cTime}>
        {e.ts.slice(11, 19)}
      </Td>
      <Td {...C} className={styles.cAgent}>
        {e.agent}
      </Td>
      <Td {...C} className={styles.cEvent}>
        <EntryLink id={e.id} label={eventLabel(e.type)} />
      </Td>
      <Td numeric {...C} className={styles.cAmount}>
        {e.amount?.display ?? ""}
      </Td>
      <Td data {...C} className={`${styles.policy} ${styles.cPolicy}`}>
        v{e.policy.version} · {e.policy.hash.slice(0, 6)}
      </Td>
      <Td {...C} className={styles.cResult}>
        <Badge kind={result.kind} label={result.label} />
      </Td>
      <Td {...C} className={styles.cVerify}>
        {explorer ? (
          <a href={explorer} target="_blank" rel="noreferrer" aria-label={`Verify entry ${e.seq} on nearblocks (opens in new tab)`}>
            nearblocks
          </a>
        ) : (
          <Link href={`/ledger/${e.id}#verify`} className={styles.offchain}>
            {e.result === "block" ? "nothing on-chain" : "off-chain"}
          </Link>
        )}
      </Td>
    </Row>
  );
}

export function LedgerTable({ caption, entries, all, live }: { caption: string; entries: readonly LedgerEntry[]; all: readonly LedgerEntry[]; live?: ReactNode }) {
  return (
    <Table caption={caption} className={styles.ledger} explicitRoles>
      <LedgerHead />
      {live}
      <tbody role="rowgroup">
        {entries.map((e) => (
          <LedgerRow key={e.id} e={e} all={all} />
        ))}
      </tbody>
    </Table>
  );
}
