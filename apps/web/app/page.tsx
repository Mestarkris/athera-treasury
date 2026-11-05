import Link from "next/link";
import { Suspense } from "react";
import { EntrySheetHost } from "../components/ledger/EntrySheetHost";
import { LedgerTable } from "../components/ledger/LedgerTable";
import { buttonClass } from "../components/ui/Button";
import page from "../components/ui/page.module.css";
import { readLedger } from "../lib/ledger";
import { getStatus } from "../lib/status";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

function Meter({ label, used, limit, ratio, note }: { label: string; used: string; limit: string; ratio: number; note?: string }) {
  const pct = Math.min(Math.max(ratio, 0), 1);
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span>{label}</span>
        <span className="data">
          {used} <span className={page.muted}>of</span> {limit}
        </span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        aria-valuetext={`${used} of ${limit}`}
      >
        <span className={styles.fill} style={{ transform: `scaleX(${pct})` }} data-near={pct >= 0.8} />
      </div>
      {note ? <p className={page.note}>{note}</p> : null}
    </div>
  );
}

function RecentLedger() {
  const { entries } = readLedger();
  const recent = entries.slice(-8).reverse();
  return recent.length ? (
    <LedgerTable caption={`Latest ${recent.length} of ${entries.length} entries`} entries={recent} all={entries} />
  ) : (
    <p className={page.muted}>The ledger is empty. Run the demo loop to create the first entries.</p>
  );
}

export default async function ControlRoom() {
  const s = await getStatus();
  const moved = BigInt(s.today.moved.value);
  const perDay = BigInt(s.today.perDay.value);
  const ratio = perDay > 0n ? Number((moved * 10_000n) / perDay) / 10_000 : 0;
  const inferenceRatio = Number(s.today.inference.usedUsd) / Number(s.today.inference.limitUsd || "1");
  const halted = s.killSwitch.engaged || s.killSwitch.configFlag;

  return (
    <>
      <div className={page.head}>
        <h1>Control room</h1>
        <p className={page.lead}>
          Agents act only inside <Link href="/policy">config.yaml</Link> (policy v{s.policy.version},{" "}
          <span className="data">{s.policy.hash.slice(0, 6)}</span>). Every value moves as a NEAR Intent on {s.network}, and every step is written to the{" "}
          <Link href="/ledger">ledger</Link>.
        </p>
        <div className={page.actions}>
          <Link href="/demo" className={buttonClass("primary")}>
            Run demo loop
          </Link>
          <Link href="/ledger" className={buttonClass("secondary")}>
            Open ledger
          </Link>
        </div>
      </div>

      <section className={page.section} aria-labelledby="limits">
        <div className={page.sectionHead}>
          <h2 id="limits">Today against limits</h2>
          <p>UTC day {s.today.date}. Counted from the ledger: every submitted intent counts unless its settlement is recorded as failed.</p>
        </div>
        <div className={`${page.body} ${styles.meters}`}>
          <Meter label={`Capital moved from ${s.treasury}`} used={s.today.moved.display} limit={`${s.today.perDay.display} per day`} ratio={ratio} />
          <Meter
            label="Inference spend"
            used={`$${s.today.inference.usedUsd}`}
            limit={`$${s.today.inference.limitUsd} per day`}
            ratio={inferenceRatio}
            note="The treasury agent is rule-based and makes no model calls, so this stays at zero. The limit is still enforced."
          />
          <dl className={page.dl}>
            <dt>Per transaction</dt>
            <dd className="data">{s.today.perTx.display} maximum</dd>
            <dt>Treasury balance</dt>
            <dd>
              {s.balance.display ? (
                <>
                  <span className="data">{s.balance.display}</span>{" "}
                  <span className={page.muted}>
                    inside {s.verifier}, read {s.balance.at.slice(11, 19)} UTC
                  </span>
                </>
              ) : (
                <span className={page.muted}>RPC unavailable right now</span>
              )}
            </dd>
            <dt>Ledger</dt>
            <dd>
              <span className="data">{s.ledger.entries}</span> entries, hash chain{" "}
              {s.ledger.chainOk ? "intact" : <strong className={styles.bad}>broken</strong>}
            </dd>
          </dl>
        </div>
      </section>

      <section className={page.section} aria-labelledby="kill">
        <div className={page.sectionHead}>
          <h2 id="kill">Kill switch</h2>
          <p>Hold the control in the status bar for 1.2 seconds. Every agent stops at its next step and nothing new is signed or submitted.</p>
        </div>
        <div className={page.body}>
          <p className={halted ? styles.haltedText : undefined}>
            {halted
              ? `Engaged${s.killSwitch.since ? ` at ${s.killSwitch.since.slice(11, 19)} UTC` : ""}: ${s.killSwitch.configFlag ? "kill_switch is true in config.yaml" : s.killSwitch.reason}.`
              : "Not engaged."}{" "}
            An intent already broadcast cannot be recalled. Anything it leaves unfinished is picked up by the next run, through the same policy checks.
          </p>
        </div>
      </section>

      <section className={page.section} aria-labelledby="recent">
        <div className={page.sectionHead}>
          <h2 id="recent">Recent ledger</h2>
          <p>Newest first. Every row shows its policy hash and how to verify it.</p>
        </div>
        <div className={page.body}>
          <Suspense fallback={<p className={page.muted}>Reading the ledger…</p>}>
            <RecentLedger />
          </Suspense>
        </div>
      </section>
      <EntrySheetHost />
    </>
  );
}
