import { Braces, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import type { LedgerEntry } from "@athera/ledger";
import { EntrySheetHost } from "../../components/ledger/EntrySheetHost";
import { LedgerTable } from "../../components/ledger/LedgerTable";
import { LiveRows } from "../../components/ledger/LiveRows";
import { PageTransition } from "../../components/ui/PageTransition";
import { Badge } from "../../components/ui/badge";
import { Button, buttonVariants } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { PageHeader } from "../../components/ui/page-header";
import { readLedger } from "../../lib/ledger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ledger" };

const TYPES: LedgerEntry["type"][] = ["policy_check", "proposal", "intent_created", "intent_submitted", "settlement", "fee", "payout", "cost", "halt", "error"];
const AGENTS: LedgerEntry["agent"][] = ["treasury", "accounting", "policy", "settlement", "operator", "system", "procurement", "sales"];
const PAGE = 50;

// Native <select> styled like shadcn inputs: keyboard and screen-reader behaviour for free, no JS.
const selectClass =
  "border-input bg-background dark:bg-input/30 h-9 min-w-40 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] pointer-coarse:h-11";

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
  const caption = `Ledger, newest first${type ? `, event ${type.replace("_", " ")}` : ""}${agent ? `, agent ${agent}` : ""}${run ? `, run ${run}` : ""}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entries</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            <span className="data">{filtered.length}</span> of <span className="data">{entries.length}</span> entries{type || agent || run ? " match" : ""}
          </span>
          <Badge variant={chain.ok ? "success" : "danger"}>{chain.ok ? "Hash chain intact" : `Hash chain broken at seq ${chain.seq}`}</Badge>
          <a
            href={`/api/ledger${type || agent ? `?${new URLSearchParams({ ...(type ? { type } : {}), ...(agent ? { agent } : {}) })}` : ""}`}
            className="inline-flex items-center gap-1 underline underline-offset-4"
          >
            <Braces className="size-3.5" aria-hidden="true" />
            JSON
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <LedgerTable
          caption={caption}
          entries={shown}
          all={entries}
          live={run || before !== undefined ? undefined : <LiveRows afterSeq={lastSeq} type={type} agent={agent} />}
        />
        {filtered.length === 0 ? <p className="text-muted-foreground text-sm">No entries match these filters.</p> : null}
        <nav aria-label="Ledger pages" className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-sm">
            {shown.length ? (
              <>
                Showing <span className="data">{String(shown.at(-1)?.seq ?? 0).padStart(4, "0")}</span>–
                <span className="data">{String(shown[0]?.seq ?? 0).padStart(4, "0")}</span>
              </>
            ) : null}
          </span>
          <div className="flex gap-2">
            {before !== undefined ? (
              <Link href={qs({})} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ChevronLeft aria-hidden="true" />
                Newest entries
              </Link>
            ) : null}
            {older !== undefined ? (
              <Link href={qs({ before: String(older) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Older entries
                <ChevronRight aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </nav>
      </CardContent>
    </Card>
  );
}

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const filtered = Boolean(search.type || search.agent || search.run);
  return (
    <PageTransition>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <PageHeader
          title="Ledger"
          description="Append-only and hash-chained: every policy check (passed and blocked), proposal, intent, settlement, fee and payout. New entries appear as they are written, and every row links to its own page."
        />

        <form method="get" action="/ledger" className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="filter-type">Event</Label>
            <select id="filter-type" name="type" defaultValue={search.type ?? ""} className={selectClass}>
              <option value="">All events</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="filter-agent">Agent</Label>
            <select id="filter-agent" name="agent" defaultValue={search.agent ?? ""} className={selectClass}>
              <option value="">All agents</option>
              {AGENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          {search.run ? <input type="hidden" name="run" value={search.run} /> : null}
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {filtered ? (
            <Link href="/ledger" className={buttonVariants({ variant: "ghost" })}>
              Clear filters
            </Link>
          ) : null}
        </form>

        <Suspense fallback={<p className="text-muted-foreground text-sm">Reading the ledger…</p>}>
          <Rows search={search} />
        </Suspense>
        <EntrySheetHost />
      </div>
    </PageTransition>
  );
}
