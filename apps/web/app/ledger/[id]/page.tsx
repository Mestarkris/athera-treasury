import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";
import type { LedgerEntry } from "@athera/ledger";
import { eventLabel } from "../../../components/ledger/LedgerTable";
import { PageTransition } from "../../../components/ui/PageTransition";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Hash } from "../../../components/ui/hash";
import { StatusBadge } from "../../../components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { displayResult } from "../../../lib/display";
import { currentPolicy, howToVerify, readLedger } from "../../../lib/ledger";
import { cn } from "../../../lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Entry ${id}` };
}

type RuleRow = { rule: string; status: "pass" | "block" | "skip"; detail: string };

function rulesOf(e: LedgerEntry): RuleRow[] | null {
  const p = e.payload as { rules?: RuleRow[] } | undefined;
  return e.type === "policy_check" && Array.isArray(p?.rules) ? p.rules : null;
}

function EntryList({ items, empty }: { items: LedgerEntry[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>;
  return (
    <ol className="grid gap-2">
      {items.map((x) => (
        <li key={x.id} className="text-sm [overflow-wrap:anywhere]">
          <Link href={`/ledger/${x.id}`} className="data underline underline-offset-4">
            {String(x.seq).padStart(4, "0")}
          </Link>{" "}
          <span className="font-medium">{eventLabel(x.type)}</span> <StatusBadge {...displayResult(x, [])} />{" "}
          <span className="text-muted-foreground">{x.summary}</span>
        </li>
      ))}
    </ol>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 text-sm [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { entries } = await readLedger();
  const e = entries.find((x) => x.id === id);
  if (!e) notFound();
  const byId = new Map(entries.map((x) => [x.id, x]));
  const upstream = (e.upstream ?? []).map((u) => byId.get(u)).filter((x): x is LedgerEntry => x !== undefined);
  const downstream = entries.filter((x) => x.upstream?.includes(e.id));
  const policy = await currentPolicy();
  const verify = howToVerify(e, policy.submitter);
  const rules = rulesOf(e);
  const result = displayResult(e, entries);
  const r = e.refs ?? {};
  const lastSeq = entries.at(-1)?.seq ?? 0;
  // The list pages 50 at a time; send "back" to the page that actually contains this row.
  const backHref = lastSeq - e.seq < 50 ? `/ledger#${e.id}` : `/ledger?before=${e.seq + 1}#${e.id}`;
  const title = `${eventLabel(e.type)[0]?.toUpperCase() ?? ""}${eventLabel(e.type).slice(1)}`;

  return (
    <PageTransition>
      <article className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <nav aria-label="Breadcrumb" className="text-muted-foreground flex items-center gap-1 text-sm">
            <Link href={backHref} transitionTypes={["nav-back"]} className="hover:text-foreground">
              Ledger
            </Link>
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <span>
              Entry <span className="data">{String(e.seq).padStart(4, "0")}</span>
            </span>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <ViewTransition name={`entry-${e.id}`} share="entry-morph" default="none">
              <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            </ViewTransition>
            <StatusBadge kind={result.kind} label={result.label} />
          </div>
          <p className={cn("max-w-3xl text-lg", e.result === "block" && "border-destructive border-l-2 pl-3")}>{e.summary}</p>
          {result.resolvedBy ? (
            <p className="text-muted-foreground text-sm">
              Settled by entry{" "}
              <Link href={`/ledger/${result.resolvedBy}`} className="data underline underline-offset-4">
                {result.resolvedBy}
              </Link>
            </p>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Record</CardTitle>
            <CardDescription>Exactly what the ledger file holds for this entry.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[minmax(8rem,max-content)_minmax(0,1fr)] gap-x-6 gap-y-3">
              <Field label="Entry ID">
                <Hash value={e.id} label="entry id" head={16} tail={0} />
              </Field>
              <Field label="Sequence">
                <span className="data">{e.seq}</span>
              </Field>
              <Field label="Time">
                <span className="data">{e.ts}</span>
              </Field>
              <Field label="Run">
                <Link href={`/ledger?${new URLSearchParams({ run: e.run_id })}`} className="data underline underline-offset-4">
                  {e.run_id}
                </Link>
              </Field>
              <Field label="Agent">{e.agent}</Field>
              {e.amount ? (
                <Field label="Amount">
                  <span className="data">{e.amount.display}</span>{" "}
                  <span className="text-muted-foreground data">
                    ({e.amount.value} base units of {e.amount.asset})
                  </span>
                </Field>
              ) : null}
              <Field label="Policy">
                <Link href="/policy" className="data underline underline-offset-4">
                  v{e.policy.version} · {e.policy.hash.slice(0, 6)}
                </Link>{" "}
                <span className="text-muted-foreground">{e.policy.hash === policy.hash ? "(current)" : "(not the current policy)"}</span>
              </Field>
              {r.intent_hash ? (
                <Field label="Intent hash">
                  <Hash value={r.intent_hash} label="intent hash" head={10} tail={6} />
                </Field>
              ) : null}
              {r.tx_hash ? (
                <Field label="Transaction">
                  <Hash value={r.tx_hash} href={r.explorer?.[0]} label="transaction" head={10} tail={6} />
                </Field>
              ) : null}
              {r.block_height ? (
                <Field label="Block">
                  <span className="data">{r.block_height}</span>
                </Field>
              ) : null}
              {r.memo ? (
                <Field label="On-chain memo">
                  <span className="data">{r.memo}</span>
                </Field>
              ) : null}
              {r.signer_id ? (
                <Field label="Intent signer">
                  <span className="data">{r.signer_id}</span>
                </Field>
              ) : null}
              <Field label="Entry hash">
                <Hash value={e.hash} label="entry hash" head={12} tail={6} />{" "}
                <span className="text-muted-foreground">
                  follows <span className="data">{e.prev_hash.slice(0, 12)}…</span>
                </span>
              </Field>
            </dl>
          </CardContent>
        </Card>

        {rules ? (
          <Card>
            <CardHeader>
              <CardTitle>Policy rules</CardTitle>
              <CardDescription>
                Every rule ran, in order: {rules.filter((x) => x.status === "pass").length} passed, {rules.filter((x) => x.status === "block").length} blocked,{" "}
                {rules.filter((x) => x.status === "skip").length} not applicable.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table label="Policy rules for this check">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Rule</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((x) => (
                    <TableRow key={x.rule} className={cn(x.status === "block" && "[&>td:first-child]:shadow-[inset_2px_0_0_var(--destructive)]")}>
                      <TableCell className="data" translate="no">
                        {x.rule}
                      </TableCell>
                      <TableCell>{x.status === "skip" ? <span className="text-muted-foreground text-sm">Not applicable</span> : <StatusBadge kind={x.status} />}</TableCell>
                      <TableCell className="whitespace-normal">{x.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Upstream</CardTitle>
              <CardDescription>The entries this one follows from.</CardDescription>
            </CardHeader>
            <CardContent>
              <EntryList items={upstream} empty="None: this starts a chain." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Downstream</CardTitle>
              <CardDescription>The entries that follow from this one.</CardDescription>
            </CardHeader>
            <CardContent>
              <EntryList items={downstream} empty="Nothing follows from this entry." />
            </CardContent>
          </Card>
        </div>

        <Card id="verify">
          <CardHeader>
            <CardTitle>How to verify this yourself</CardTitle>
            <CardDescription>No access to our systems needed: only a public NEAR RPC and this page.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4 text-sm">
            {verify.onChain ? (
              <ol className="list-decimal space-y-4 pl-5 [overflow-wrap:anywhere]">
                <li>
                  Open the transaction on an explorer (
                  {verify.explorer.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                      nearblocks
                    </a>
                  ))}
                  ), or ask any public RPC directly:
                  <pre tabIndex={0} translate="no" className="data bg-muted/40 mt-2 overflow-x-auto rounded-lg border p-3 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {verify.rpc}
                  </pre>
                </li>
                <li>
                  Check that:
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {verify.expect.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </li>
              </ol>
            ) : (
              <p>{verify.note}</p>
            )}
            <p className="text-muted-foreground">
              Integrity of the ledger itself: recompute <span className="data">sha256</span> over the canonical JSON of this entry without{" "}
              <span className="data">id</span> and <span className="data">hash</span>, and check it equals the entry hash and the next entry’s{" "}
              <span className="data">prev_hash</span>. The raw entry is at{" "}
              <a href={`/api/ledger/${e.id}`} className="underline underline-offset-4">
                /api/ledger/{e.id}
              </a>
              .
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Full payload</CardTitle>
            <CardDescription>The entry exactly as stored, including the agent’s proposal or the verifier events.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre
              tabIndex={0}
              aria-label="Entry JSON"
              translate="no"
              className="data bg-muted/40 max-h-[32rem] overflow-auto rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {JSON.stringify(e, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </article>
    </PageTransition>
  );
}
