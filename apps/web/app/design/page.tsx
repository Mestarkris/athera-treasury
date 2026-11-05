import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LedgerEntry } from "@athera/ledger";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { CodeView } from "../../components/ui/CodeView";
import { Hash } from "../../components/ui/Hash";
import { Row, Table, Td, Th } from "../../components/ui/Table";
import { Timeline, type Stage } from "../../components/ui/Timeline";
import { ROOT, currentPolicy, readLedger } from "../../lib/ledger";
import { STAGES, stageEntries, stagesFromRun } from "../../lib/stages";
import { contrast, readTokens } from "../../lib/tokens";
import { displayResult } from "../../lib/display";
import { HoldSpecimen, SheetSpecimen } from "./Specimens";
import styles from "./design.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Design system" };

const COLOR_ROLES: { token: string; use: string; on?: string }[] = [
  { token: "--paper", use: "Page" },
  { token: "--paper-sunk", use: "Code, selected row, sheet" },
  { token: "--ink", use: "Primary text and controls", on: "--paper" },
  { token: "--ink-2", use: "Secondary text", on: "--paper" },
  { token: "--ink-3", use: "Tertiary text", on: "--paper" },
  { token: "--rule", use: "Hairlines only" },
  { token: "--rule-strong", use: "Hairlines only" },
  { token: "--signal-pass", use: "Passed, confirmed", on: "--paper" },
  { token: "--signal-block", use: "Blocked, halted, failed", on: "--paper" },
  { token: "--signal-pending", use: "Submitted, awaiting finality", on: "--paper" },
];

function stageDetail(e: LedgerEntry | undefined) {
  if (!e) return undefined;
  const r = e.refs ?? {};
  return (
    <span>
      <a href={`/ledger/${e.id}`} className="data">
        {e.id}
      </a>
      {r.tx_hash ? (
        <>
          {" · tx "}
          <Hash value={r.tx_hash} href={r.explorer?.[0]} label="transaction" />
        </>
      ) : null}
    </span>
  );
}

function runTimeline(run: LedgerEntry[]): Stage[] {
  const found = stageEntries(run);
  const { stages } = stagesFromRun(run, true);
  return stages.map((s, i) => ({ ...s, detail: stageDetail(found[STAGES[i]!.key]) }));
}

export default function DesignPage() {
  const tokens = readTokens();
  const { entries, chain } = readLedger();
  const policy = currentPolicy();
  const config = readFileSync(resolve(ROOT, "config.yaml"), "utf8");

  const runs = new Map<string, LedgerEntry[]>();
  for (const e of entries) runs.set(e.run_id, [...(runs.get(e.run_id) ?? []), e]);
  const all = [...runs.values()];
  const completed = all.findLast((r) => r.some((e) => e.type === "payout") && r[0]?.type === "proposal");
  const blocked = all.findLast((r) => r.some((e) => e.type === "policy_check" && e.result === "block"));
  const halted = all.findLast((r) => r.some((e) => e.type === "halt"));
  const recent = entries.slice(-8).reverse();
  // Table specimen: a real window of the ledger around the most recent block, so the blocked-row
  // treatment is shown on real data. Newest first.
  const lastBlock = entries.findLast((e) => e.result === "block");
  const windowStart = lastBlock ? Math.max(0, lastBlock.seq - 3) : Math.max(0, entries.length - 10);
  const tableRows = entries.slice(windowStart, windowStart + 10).reverse();
  const settlement = entries.findLast((e) => e.type === "settlement" && e.refs?.tx_hash);

  return (
    <main className={styles.page}>
      <h1>Design system</h1>
      <p className={styles.intro}>
        Internal reference for the flight-recorder interface. Tokens are parsed from <code className="data">styles/tokens.css</code>, contrast is computed live,
        and every specimen below renders real data from the mainnet ledger ({entries.length} entries, hash chain {chain.ok ? "intact" : "BROKEN"}) and{" "}
        <code className="data">config.yaml</code> (policy v{policy.version} · <span className="data">{policy.hash.slice(0, 6)}</span>).
      </p>

      <section className={styles.section} aria-labelledby="colour">
        <div className={styles.sectionHead}>
          <h2 id="colour">Colour</h2>
          <p>Paper and ink, plus exactly three signals. Contrast is against paper in each theme; AA needs 4.5.</p>
        </div>
        <div className={styles.full}>
          <Table caption="Colour tokens, light and dark" dense>
            <thead>
              <tr>
                <Th>Token</Th>
                <Th>Use</Th>
                <Th numeric>Light</Th>
                <Th numeric>On paper</Th>
                <Th numeric>Dark</Th>
                <Th numeric>On paper</Th>
              </tr>
            </thead>
            <tbody>
              {COLOR_ROLES.map(({ token, use, on }) => {
                const l = tokens.light[token] ?? "";
                const d = tokens.dark[token] ?? "";
                const lc = on ? contrast(l, tokens.light[on] ?? "") : undefined;
                const dc = on ? contrast(d, tokens.dark[on] ?? "") : undefined;
                return (
                  <Row key={token}>
                    <Td data>{token}</Td>
                    <Td>{use}</Td>
                    <Td numeric>
                      <span className={styles.swatch} style={{ background: l }} /> {l}
                    </Td>
                    <Td numeric>{lc ? `${lc.toFixed(2)}:1` : "–"}</Td>
                    <Td numeric>
                      <span className={styles.swatch} style={{ background: d }} /> {d}
                    </Td>
                    <Td numeric>{dc ? `${dc.toFixed(2)}:1` : "–"}</Td>
                  </Row>
                );
              })}
            </tbody>
          </Table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="type">
        <div className={styles.sectionHead}>
          <h2 id="type">Type</h2>
          <p>Archivo for the interface, IBM Plex Mono for data. Five sizes only.</p>
        </div>
        <div className={styles.full}>
          {(
            [
              ["--text-5", 32, <span key="5" style={{ fontSize: "var(--text-5)", fontWeight: 600 }}>Policy v{policy.version}</span>],
              ["--text-4", 22, <span key="4" style={{ fontSize: "var(--text-4)", fontWeight: 600 }}>Recent ledger</span>],
              ["--text-3", 17, <span key="3" style={{ fontSize: "var(--text-3)" }}>{recent[0]?.summary}</span>],
              ["--text-2", 14, <span key="2">{blocked?.find((e) => e.result === "block")?.summary}</span>],
              ["--text-1", 12, <span key="1" className="data" style={{ fontSize: "var(--text-1)" }}>{settlement?.refs?.intent_hash}</span>],
            ] as const
          ).map(([t, px, el]) => (
            <div key={t} className={styles.typeRow}>
              <span className={`data ${styles.muted}`}>{px}px</span>
              {el}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="space">
        <div className={styles.sectionHead}>
          <h2 id="space">Space, radii, motion, layers</h2>
          <p>4px spacing, radii 0–4px. Motion animates transform and opacity only.</p>
        </div>
        <div className={styles.full}>
          <Table caption="Non-colour tokens" dense>
            <thead>
              <tr>
                <Th>Token</Th>
                <Th numeric>Value</Th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(tokens.light)
                .filter(([k]) => /^--(s-|radius|ease|dur-|stagger|z-|tap|gutter|page-)/.test(k))
                .map(([k, v]) => (
                  <Row key={k}>
                    <Td data>{k}</Td>
                    <Td numeric>{v}</Td>
                  </Row>
                ))}
            </tbody>
          </Table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="badges">
        <div className={styles.sectionHead}>
          <h2 id="badges">Badges and buttons</h2>
          <p>Status uses a glyph and a word, never colour alone. STUB marks anything not real.</p>
        </div>
        <div className={styles.full}>
          <div className={styles.row}>
            {(["pass", "block", "pending", "confirmed", "failed", "halted", "info", "stub"] as const).map((k) => (
              <Badge key={k} kind={k} />
            ))}
          </div>
          <div className={styles.row} style={{ marginTop: "var(--s-6)" }}>
            <Button variant="primary">Run demo loop</Button>
            <Button>Filter</Button>
            <Button variant="quiet">Copy JSON</Button>
            <Button variant="danger">Trigger invalid action</Button>
            <Button disabled>Disabled</Button>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="hold">
        <div className={styles.sectionHead}>
          <h2 id="hold">Hold to confirm</h2>
          <p>The kill switch control. It fires the moment 1.2s completes and never waits on the fill. Releasing early cancels.</p>
        </div>
        <div className={styles.full}>
          <HoldSpecimen />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="table">
        <div className={styles.sectionHead}>
          <h2 id="table">Ledger table</h2>
          <p>A real table: data right-aligned in mono, policy hash and verify link on every row, a 2px rule on blocks.</p>
        </div>
        <div className={styles.full}>
          <Table caption={`Entries ${String(tableRows.at(-1)?.seq ?? 0).padStart(4, "0")}–${String(tableRows[0]?.seq ?? 0).padStart(4, "0")} of ${entries.length}, around the most recent block`}>
            <thead>
              <tr>
                <Th numeric>Seq</Th>
                <Th numeric>Time (UTC)</Th>
                <Th>Agent</Th>
                <Th>Event</Th>
                <Th numeric>Amount</Th>
                <Th>Policy</Th>
                <Th>Result</Th>
                <Th>Verify</Th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((e) => (
                <Row key={e.id} id={e.id} blocked={e.result === "block"}>
                  <Td numeric>{String(e.seq).padStart(4, "0")}</Td>
                  <Td numeric>{e.ts.slice(11, 19)}</Td>
                  <Td>{e.agent}</Td>
                  <Td>
                    <a href={`/ledger/${e.id}`}>{e.type.replace("_", " ")}</a>
                  </Td>
                  <Td numeric>{e.amount?.display ?? ""}</Td>
                  <Td data>
                    v{e.policy.version} · {e.policy.hash.slice(0, 6)}
                  </Td>
                  <Td>
                    <Badge {...displayResult(e, entries)} />
                  </Td>
                  <Td>
                    {e.refs?.explorer?.[0] ? (
                      <a href={e.refs.explorer[0]} target="_blank" rel="noreferrer">
                        nearblocks
                      </a>
                    ) : (
                      <span className={styles.muted}>off-chain</span>
                    )}
                  </Td>
                </Row>
              ))}
            </tbody>
          </Table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="hash">
        <div className={styles.sectionHead}>
          <h2 id="hash">Hashes and IDs</h2>
          <p>Head and tail visible, the full value in copy and in the accessible name.</p>
        </div>
        <div className={styles.full}>
          {settlement?.refs?.tx_hash ? (
            <div className={styles.row}>
              <Hash value={settlement.refs.tx_hash} href={settlement.refs.explorer?.[0]} label="transaction" />
              {settlement.refs.intent_hash ? <Hash value={settlement.refs.intent_hash} label="intent hash" /> : null}
              <Hash value={policy.hash} label="policy hash" head={6} tail={0} />
            </div>
          ) : (
            <p className={styles.muted}>No settlement in the ledger yet.</p>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="timeline">
        <div className={styles.sectionHead}>
          <h2 id="timeline">Timeline</h2>
          <p>The seven loop stages, rebuilt from three real runs. Only recorded events mark a stage done.</p>
        </div>
        <div className={styles.full}>
          <div className={styles.runs}>
            {(
              [
                ["Completed run", completed],
                ["Blocked run", blocked],
                ["Halted run", halted],
              ] as const
            ).map(([title, run]) =>
              run ? (
                <div key={title}>
                  <h3 className={styles.subhead}>{title}</h3>
                  <Timeline label={`${title} ${run[0]?.run_id}`} stages={runTimeline(run)} />
                </div>
              ) : null,
            )}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="yaml">
        <div className={styles.sectionHead}>
          <h2 id="yaml">Code and YAML</h2>
          <p>Read-only. The policy is edited through git, never in the interface.</p>
        </div>
        <div className={styles.full}>
          <CodeView source={config} label={`config.yaml · policy v${policy.version} · ${policy.hash.slice(0, 6)}`} />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="sheet">
        <div className={styles.sectionHead}>
          <h2 id="sheet">Sheet</h2>
          <p>A bottom sheet on phones (drag down to dismiss) and a side panel on wide screens. It is non-modal, so the kill switch stays reachable.</p>
        </div>
        <div className={styles.full}>
          {recent[0] ? <SheetSpecimen title={`Ledger entry ${recent[0].id}`} json={JSON.stringify(recent[0], null, 2)} /> : null}
        </div>
      </section>
    </main>
  );
}
