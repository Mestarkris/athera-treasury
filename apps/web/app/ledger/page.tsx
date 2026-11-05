import Link from "next/link";
import { Suspense } from "react";
import type { LedgerEntry } from "@athera/ledger";
import { LedgerTable } from "../../components/ledger/LedgerTable";
import { EntrySheetHost } from "../../components/ledger/EntrySheetHost";
import { LiveRows } from "../../components/ledger/LiveRows";
import { PageTransition } from "../../components/ui/PageTransition";
import { Button } from "../../components/ui/Button";
import page from "../../components/ui/page.module.css";
import { readLedger } from "../../lib/ledger";
import styles from "./ledger-page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ledger" };

const TYPES: LedgerEntry["type"][] = ["policy_check", "proposal", "intent_created", "intent_submitted", "settlement", "fee", "payout", "cost", "halt", "error"];
const AGENTS: LedgerEntry["agent"][] = ["treasury", "accounting", "policy", "settlement", "operator", "system", "procurement", "sales"];
const PAGE = 50;

type Search = { type?: string; agent?: string; run?: string; before?: string };

async function Rows({ search }: { search: Search }) {
  const { entries, chain } = readLedger();
  const type = TYPES.find((t) => t === search.type);
  const agent = AGENTS.find((a) => a === search.agent);
  const run = search.run && /^[a-z0-9]{1,40}$/.test(search.run) ? search.run : undefined;
  const before = search.before && /^\d{1,9}$/.test(search.before) ? Number(search.before) : undefined;
  const filtered = entries.filter((e) => (!type || e.type === type) && (!agent || e.agent === agent) && (!run || e.run_id === run)).reverse();
  // Pages of 50, newest first. `before` (a seq) is in the URL, so every page is linkable.
  const fromHere = before === undefined ? filtered : filtered.filter((e) => e.seq < before);
  const shown = fromHere.slice(0, PAGE);
  const older = fromHere.length > shown.length ? shown.at(-1)?.seq : undefined;
  const lastSeq = entries.at(-1)?.seq ?? -1;
  const qs = (extra: Record<string, string>) => `/ledger?${new URLSearchParams({ ...(type ? { type } : {}), ...(agent ? { agent } : {}), ...(run ? { run } : {}), ...extra })}`;
  return (
    <>
      <p className={styles.count}>
        <span className="data">{filtered.length}</span> of <span className="data">{entries.length}</span> entries
        {type || agent ? " match" : ""}. Hash chain {chain.ok ? "intact" : <strong className={styles.bad}>broken at seq {chain.seq}</strong>}.{" "}
        <a href={`/api/ledger${type || agent ? `?${new URLSearchParams({ ...(type ? { type } : {}), ...(agent ? { agent } : {}) })}` : ""}`}>JSON</a>
      </p>
      <LedgerTable
        caption={`Ledger, newest first${type ? `, event ${type.replace("_", " ")}` : ""}${agent ? `, agent ${agent}` : ""}${run ? `, run ${run}` : ""}`}
        entries={shown}
        all={entries}
        live={run || before !== undefined ? undefined : <LiveRows afterSeq={lastSeq} type={type} agent={agent} />}
      />
      <nav className={styles.more} aria-label="Ledger pages">
        {before !== undefined ? <Link href={qs({})}>Newest entries</Link> : null}
        {older !== undefined ? <Link href={qs({ before: String(older) })}>Older entries</Link> : null}
        {shown.length ? (
          <span className={page.muted}>
            Showing <span className="data">{String(shown.at(-1)?.seq ?? 0).padStart(4, "0")}</span>–<span className="data">{String(shown[0]?.seq ?? 0).padStart(4, "0")}</span>
          </span>
        ) : null}
      </nav>
      {filtered.length === 0 ? <p className={page.muted}>No entries match these filters.</p> : null}
    </>
  );
}

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const filtered = Boolean(search.type || search.agent || search.run);
  return (
    <PageTransition>
      <div>
      <div className={page.head}>
        <h1>Ledger</h1>
        <p className={page.lead}>
          Append-only and hash-chained. Every policy check (passed and blocked), proposal, intent, settlement, fee and payout. New entries appear here as they are
          written. Every row links to its own page.
        </p>
      </div>

      <form className={styles.filters} method="get" action="/ledger">
        <label>
          <span>Event</span>
          <select name="type" defaultValue={search.type ?? ""}>
            <option value="">All events</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Agent</span>
          <select name="agent" defaultValue={search.agent ?? ""}>
            <option value="">All agents</option>
            {AGENTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {search.run ? <input type="hidden" name="run" value={search.run} /> : null}
        <Button type="submit">Filter</Button>
        {filtered ? (
          <Link href="/ledger" className={styles.clear}>
            Clear filters
          </Link>
        ) : null}
      </form>

      <div className={styles.table}>
        <Suspense fallback={<p className={page.muted}>Reading the ledger…</p>}>
          <Rows search={search} />
        </Suspense>
      </div>
      <EntrySheetHost />
      </div>
    </PageTransition>
  );
}
