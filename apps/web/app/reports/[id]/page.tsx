import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { PageHeader } from "../../../components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { getReport, readLedger } from "../../../lib/ledger";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getReport(id);
  return { title: r ? `Report: ${r.subject}` : "Report" };
}

const usd = (n: number | null) => (n === null ? "unpriced" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function List({ items }: { items: readonly string[] }) {
  if (items.length === 0) return <p className="text-muted-foreground text-sm">None given.</p>;
  return (
    <ul className="grid list-disc gap-2 pl-5">
      {items.map((x, i) => (
        <li key={i} className="[overflow-wrap:anywhere]">
          {x}
        </li>
      ))}
    </ul>
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

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getReport(id);
  if (!r) notFound();
  const { entries } = readLedger();
  const exists = (ledgerId: string | undefined) => (ledgerId && entries.some((e) => e.id === ledgerId) ? ledgerId : undefined);
  const sale = exists(r.ledger.sale);
  const cost = exists(r.ledger.cost);
  const offer = exists(r.ledger.offer);
  const f = r.facts;

  return (
    <article className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        eyebrow={
          <span>
            Treasury report on <span className="data">{r.subject}</span>, {r.created_at.slice(0, 10)}
          </span>
        }
        title={r.analysis.headline}
        description={r.analysis.summary}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Holdings</CardTitle>
              <CardDescription>
                Read from NEAR mainnet at block <span className="data">{f.block_height}</span>. Prices from the 1Click token list at that time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Where</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Account</TableCell>
                    <TableCell>NEAR</TableCell>
                    <TableCell className="data text-right">{Number(f.native_near).toFixed(4)}</TableCell>
                    <TableCell className="data text-right">{usd(f.native_usd)}</TableCell>
                  </TableRow>
                  {f.intents.map((h) => (
                    <TableRow key={h.asset}>
                      <TableCell>NEAR Intents</TableCell>
                      <TableCell title={h.asset}>{h.symbol}</TableCell>
                      <TableCell className="data text-right">{Number(h.amount).toLocaleString("en-US", { maximumFractionDigits: 6 })}</TableCell>
                      <TableCell className="data text-right">{usd(h.usd)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="font-medium">
                      Total
                    </TableCell>
                    <TableCell className="data text-right font-medium">{usd(f.total_usd)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Observations</CardTitle>
            </CardHeader>
            <CardContent>
              <List items={r.analysis.observations} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Risks</CardTitle>
            </CardHeader>
            <CardContent>
              <List items={r.analysis.risks} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recommended policy settings</CardTitle>
              <CardDescription>Suggestions only. Nothing here changes a policy or moves funds; policy changes go through config.yaml and git.</CardDescription>
            </CardHeader>
            <CardContent>
              <List items={r.analysis.recommendations} />
            </CardContent>
          </Card>
        </div>

        <Card className="content-start">
          <CardHeader>
            <CardTitle>How this was made</CardTitle>
            <CardDescription>Every step below is a ledger entry you can check.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
              <Field label="Price">${r.price_usd}, checked against the policy's price bounds{offer ? <> (<Link href={`/ledger/${offer}`} className="data inline-flex min-h-6 items-center underline underline-offset-4">{offer}</Link>)</> : null}</Field>
              <Field label="Paid by">
                <span className="data">{r.customer}</span>
              </Field>
              <Field label="Payment">
                {sale ? (
                  <Link href={`/ledger/${sale}`} className="data inline-flex min-h-6 items-center underline underline-offset-4">
                    {sale}
                  </Link>
                ) : (
                  "not in this ledger"
                )}
                {r.payment?.near_tx_hashes.map((h) => (
                  <a key={h} href={`https://nearblocks.io/txns/${h}`} target="_blank" rel="noreferrer" className="data flex min-h-6 items-center underline underline-offset-4" title={h}>
                    tx {h.slice(0, 6)}…{h.slice(-4)}
                  </a>
                ))}
              </Field>
              <Field label="Written by">
                <span className="data">{r.model}</span> on NEAR AI Cloud
              </Field>
              <Field label="AI cost">
                ${Number(r.cost_usd).toFixed(6)}
                {cost ? (
                  <>
                    {" "}
                    (
                    <Link href={`/ledger/${cost}`} className="data inline-flex min-h-6 items-center underline underline-offset-4">
                      {cost}
                    </Link>
                    )
                  </>
                ) : null}
              </Field>
              <Field label="Account">
                {f.is_contract ? "Has a contract deployed" : "No contract"}, {f.storage_bytes.toLocaleString("en-US")} bytes of storage
              </Field>
            </dl>
          </CardContent>
        </Card>
      </div>
    </article>
  );
}
