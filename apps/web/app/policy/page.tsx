import { readFileSync } from "node:fs";
import Link from "next/link";
import { ViewTransition } from "react";
import { CodeView } from "../../components/ui/CodeView";
import { Row, Table, Td, Th } from "../../components/ui/Table";
import page from "../../components/ui/page.module.css";
import { CONFIG_PATH, currentPolicy, readLedger } from "../../lib/ledger";
import { policyDirty, policyHistory } from "../../lib/policy-history";
import styles from "./policy.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Policy" };

function Diff({ text }: { text: string }) {
  return (
    <pre className={`${styles.diff} data`} tabIndex={0}>
      {text.split("\n").map((l, i) => (
        <span key={i} className={l.startsWith("+") ? styles.add : l.startsWith("-") ? styles.del : l.startsWith("@@") ? styles.hunk : undefined}>
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

export default async function PolicyPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  const policy = currentPolicy();
  const source = readFileSync(CONFIG_PATH, "utf8");
  const history = policyHistory();
  const dirty = policyDirty();
  const selected = v ? history.find((h) => h.commit === v) : undefined;
  const shown = selected ? { source: selected.source, version: selected.version ?? "?", hash: selected.hash, key: selected.commit } : { source, version: policy.version, hash: policy.hash, key: "current" };
  const { entries } = readLedger();

  // Policy versions actually used, from the ledger: which hash every check ran under.
  const used = new Map<string, { version: number; checks: number; first: string; last: string }>();
  for (const e of entries) {
    if (e.type !== "policy_check") continue;
    const u = used.get(e.policy.hash) ?? { version: e.policy.version, checks: 0, first: e.ts, last: e.ts };
    u.checks++;
    u.last = e.ts;
    used.set(e.policy.hash, u);
  }

  return (
    <>
      <div className={page.head}>
        <h1>Policy</h1>
        <p className={page.lead}>
          The hard limits every agent works inside. Read-only here: the policy changes only through a reviewed commit to <span className="data">config.yaml</span>,
          and every check records the exact hash it ran under.
        </p>
      </div>

      <section className={page.section} aria-labelledby="current">
        <div className={page.sectionHead}>
          <h2 id="current">{selected ? "Committed version" : "Current version"}</h2>
          <p>
            v{shown.version}, sha256 of the file bytes. {!selected && dirty ? "The working copy differs from the last commit." : null}{" "}
            {selected ? <Link href="/policy">Back to the current version</Link> : null}
          </p>
        </div>
        <div className={page.body}>
          {/* Versions cross-fade (lateral: no slide). Keyed so a version change is an exit + enter. */}
          <ViewTransition key={shown.key} enter="policy-fade" exit="policy-fade" default="none">
            <div>
              <CodeView source={shown.source} label={`config.yaml · v${shown.version} · ${shown.hash}`} />
            </div>
          </ViewTransition>
        </div>
      </section>

      <section className={page.section} aria-labelledby="used">
        <div className={page.sectionHead}>
          <h2 id="used">Versions used</h2>
          <p>From the ledger: the policy hash each check ran under.</p>
        </div>
        <div className={page.body}>
          <Table caption={`${used.size} policy version(s) across ${entries.filter((e) => e.type === "policy_check").length} checks`} dense>
            <thead>
              <tr>
                <Th>Version</Th>
                <Th>Hash</Th>
                <Th numeric>Checks</Th>
                <Th numeric>First (UTC)</Th>
                <Th numeric>Last (UTC)</Th>
              </tr>
            </thead>
            <tbody>
              {[...used.entries()].map(([hash, u]) => (
                <Row key={hash}>
                  <Td>
                    v{u.version} {hash === policy.hash ? <span className={page.muted}>(current)</span> : null}
                  </Td>
                  <Td data>{hash.slice(0, 16)}…</Td>
                  <Td numeric>{u.checks}</Td>
                  <Td numeric>{u.first.slice(0, 19).replace("T", " ")}</Td>
                  <Td numeric>{u.last.slice(0, 19).replace("T", " ")}</Td>
                </Row>
              ))}
            </tbody>
          </Table>
        </div>
      </section>

      <section className={page.section} aria-labelledby="history">
        <div className={page.sectionHead}>
          <h2 id="history">Version history</h2>
          <p>Every committed change to config.yaml, newest first, with its diff. Straight from git.</p>
        </div>
        <div className={page.body}>
          {history.length === 0 ? (
            <p className={page.muted}>
              No committed versions yet. Policy changes go through git; each commit of config.yaml appears here with its hash and diff.
            </p>
          ) : (
            <ol className={styles.history}>
              {history.map((h) => (
                <li key={h.commit} className={styles.version}>
                  <div className={styles.versionHead}>
                    <strong>v{h.version ?? "?"}</strong>
                    <span className="data">{h.hash.slice(0, 6)}</span>
                    <span>{h.subject}</span>
                    <span className={`${page.muted} data`}>
                      commit {h.commit.slice(0, 7)} on {h.date.slice(0, 10)}
                    </span>
                    {h.hash === policy.hash ? <span className={page.muted}>current</span> : null}
                    <Link href={`/policy?v=${h.commit}`} scroll={false}>
                      Show this version
                    </Link>
                  </div>
                  {h.diff ? <Diff text={h.diff} /> : <p className={page.note}>First committed version.</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </>
  );
}
