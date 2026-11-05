import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition } from "react";
import { PageTransition } from "../../../components/ui/PageTransition";
import type { LedgerEntry } from "@athera/ledger";
import { eventLabel } from "../../../components/ledger/LedgerTable";
import { Badge } from "../../../components/ui/Badge";
import { Hash } from "../../../components/ui/Hash";
import { Row, Table, Td, Th } from "../../../components/ui/Table";
import page from "../../../components/ui/page.module.css";
import { displayResult } from "../../../lib/display";
import { currentPolicy, howToVerify, readLedger } from "../../../lib/ledger";
import styles from "./entry.module.css";

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
  if (items.length === 0) return <p className={page.muted}>{empty}</p>;
  return (
    <ol className={styles.links}>
      {items.map((x) => (
        <li key={x.id}>
          <Link href={`/ledger/${x.id}`} className="data">
            {String(x.seq).padStart(4, "0")}
          </Link>{" "}
          <span>{eventLabel(x.type)}</span> <Badge {...displayResult(x, [])} /> <span className={page.muted}>{x.summary}</span>
        </li>
      ))}
    </ol>
  );
}

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { entries } = readLedger();
  const e = entries.find((x) => x.id === id);
  if (!e) notFound();
  const byId = new Map(entries.map((x) => [x.id, x]));
  const upstream = (e.upstream ?? []).map((u) => byId.get(u)).filter((x): x is LedgerEntry => x !== undefined);
  const downstream = entries.filter((x) => x.upstream?.includes(e.id));
  const policy = currentPolicy();
  const verify = howToVerify(e, policy.submitter);
  const rules = rulesOf(e);
  const result = displayResult(e, entries);
  const r = e.refs ?? {};
  const lastSeq = entries.at(-1)?.seq ?? 0;
  // The list pages 50 at a time; send "back" to the page that actually contains this row.
  const backHref = lastSeq - e.seq < 50 ? `/ledger#${e.id}` : `/ledger?before=${e.seq + 1}#${e.id}`;

  return (
    <PageTransition>
    <article>
      <div className={page.head}>
        <p className={page.note}>
          <Link href={backHref} transitionTypes={["nav-back"]}>
            Ledger
          </Link>{" "}
          / entry <span className="data">{String(e.seq).padStart(4, "0")}</span>
        </p>
        <ViewTransition name={`entry-${e.id}`} share="entry-morph" default="none">
          <h1>
            {eventLabel(e.type)[0]?.toUpperCase()}
            {eventLabel(e.type).slice(1)}
          </h1>
        </ViewTransition>
        <p className={`${styles.summary} ${e.result === "block" ? styles.blocked : ""}`}>{e.summary}</p>
        <div>
          <Badge kind={result.kind} label={result.label} />
          {result.resolvedBy ? (
            <span className={page.note}>
              {" "}
              by settlement <Link href={`/ledger/${result.resolvedBy}`} className="data">{result.resolvedBy}</Link>
            </span>
          ) : null}
        </div>
      </div>

      <section className={page.section} aria-labelledby="facts">
        <div className={page.sectionHead}>
          <h2 id="facts">Record</h2>
          <p>Exactly what the ledger file holds for this entry.</p>
        </div>
        <dl className={`${page.body} ${page.dl}`}>
          <dt>Entry id</dt>
          <dd>
            <Hash value={e.id} label="entry id" head={16} tail={0} />
          </dd>
          <dt>Sequence</dt>
          <dd className="data">{e.seq}</dd>
          <dt>Time</dt>
          <dd className="data">{e.ts}</dd>
          <dt>Run</dt>
          <dd>
            <Link href={`/ledger?${new URLSearchParams({ run: e.run_id })}`} className="data">
              {e.run_id}
            </Link>
          </dd>
          <dt>Agent</dt>
          <dd>{e.agent}</dd>
          {e.amount ? (
            <>
              <dt>Amount</dt>
              <dd className="data">
                {e.amount.display} <span className={page.muted}>({e.amount.value} base units of {e.amount.asset})</span>
              </dd>
            </>
          ) : null}
          <dt>Policy</dt>
          <dd>
            <Link href="/policy" className="data">
              v{e.policy.version} · {e.policy.hash.slice(0, 6)}
            </Link>{" "}
            <span className={page.muted}>{e.policy.hash === policy.hash ? "(current)" : "(not the current policy)"}</span>
          </dd>
          {r.intent_hash ? (
            <>
              <dt>Intent hash</dt>
              <dd>
                <Hash value={r.intent_hash} label="intent hash" head={10} tail={6} />
              </dd>
            </>
          ) : null}
          {r.tx_hash ? (
            <>
              <dt>Transaction</dt>
              <dd>
                <Hash value={r.tx_hash} href={r.explorer?.[0]} label="transaction" head={10} tail={6} />
              </dd>
            </>
          ) : null}
          {r.block_height ? (
            <>
              <dt>Block</dt>
              <dd className="data">{r.block_height}</dd>
            </>
          ) : null}
          {r.memo ? (
            <>
              <dt>On-chain memo</dt>
              <dd className="data">{r.memo}</dd>
            </>
          ) : null}
          {r.signer_id ? (
            <>
              <dt>Intent signer</dt>
              <dd className="data">{r.signer_id}</dd>
            </>
          ) : null}
          <dt>Entry hash</dt>
          <dd>
            <Hash value={e.hash} label="entry hash" head={12} tail={6} />{" "}
            <span className={page.muted}>
              follows <span className="data">{e.prev_hash.slice(0, 12)}…</span>
            </span>
          </dd>
        </dl>
      </section>

      {rules ? (
        <section className={page.section} aria-labelledby="rules">
          <div className={page.sectionHead}>
            <h2 id="rules">Rules</h2>
            <p>Every rule ran, in order. Skipped rules do not apply to this kind of proposal.</p>
          </div>
          <div className={page.body}>
            <Table caption={`${rules.filter((x) => x.status === "pass").length} passed, ${rules.filter((x) => x.status === "block").length} blocked, ${rules.filter((x) => x.status === "skip").length} not applicable`} dense>
              <thead>
                <tr>
                  <Th>Rule</Th>
                  <Th>Result</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {rules.map((x) => (
                  <Row key={x.rule} blocked={x.status === "block"}>
                    <Td data>{x.rule}</Td>
                    <Td className={styles.nowrap}>{x.status === "skip" ? <span className={page.muted}>Not applicable</span> : <Badge kind={x.status} />}</Td>
                    <Td>{x.detail}</Td>
                  </Row>
                ))}
              </tbody>
            </Table>
          </div>
        </section>
      ) : null}

      <section className={page.section} aria-labelledby="chain">
        <div className={page.sectionHead}>
          <h2 id="chain">Before and after</h2>
          <p>The entries this one follows from, and the entries that follow from it.</p>
        </div>
        <div className={`${page.body} ${styles.pair}`}>
          <div>
            <h3 className={styles.sub}>Upstream</h3>
            <EntryList items={upstream} empty="None: this starts a chain." />
          </div>
          <div>
            <h3 className={styles.sub}>Downstream</h3>
            <EntryList items={downstream} empty="Nothing follows from this entry." />
          </div>
        </div>
      </section>

      <section className={page.section} aria-labelledby="verify-heading" id="verify">
        <div className={page.sectionHead}>
          <h2 id="verify-heading">How to verify this yourself</h2>
          <p>No access to our systems needed: only a public NEAR RPC and this page.</p>
        </div>
        <div className={page.body}>
          {verify.onChain ? (
            <ol className={styles.steps}>
              <li>
                Open the transaction on an explorer:{" "}
                {verify.explorer.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">
                    nearblocks
                  </a>
                ))}
                , or ask any public RPC directly:
                <pre className={`${styles.code} data`} tabIndex={0}>
                  {verify.rpc}
                </pre>
              </li>
              <li>
                Check that:
                <ul>
                  {verify.expect.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </li>
            </ol>
          ) : (
            <p>{verify.note}</p>
          )}
          <p className={page.note}>
            Integrity of the ledger itself: recompute <span className="data">sha256</span> over the canonical JSON of this entry without{" "}
            <span className="data">id</span> and <span className="data">hash</span>, and check it equals the entry hash and the next entry’s{" "}
            <span className="data">prev_hash</span>. The raw file is served at <a href={`/api/ledger/${e.id}`}>/api/ledger/{e.id}</a>.
          </p>
        </div>
      </section>

      <section className={page.section} aria-labelledby="payload">
        <div className={page.sectionHead}>
          <h2 id="payload">Full payload</h2>
          <p>The entry exactly as stored, including the agent’s proposal or the verifier events.</p>
        </div>
        <div className={page.body}>
          <pre className={`${styles.code} data`} tabIndex={0} aria-label="Entry JSON">
            {JSON.stringify(e, null, 2)}
          </pre>
        </div>
      </section>
    </article>
    </PageTransition>
  );
}
