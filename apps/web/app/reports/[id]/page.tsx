import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { PageHeader } from "../../../components/ui/page-header";
import { getReport, readLedger } from "../../../lib/ledger";
import { FactsSections } from "./FactsSections";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getReport(id);
  return { title: r ? `Report: ${r.subject}` : "Report" };
}


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
          <FactsSections facts={f} />

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
