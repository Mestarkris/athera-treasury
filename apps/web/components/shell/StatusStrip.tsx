"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KillSwitch } from "./KillSwitch";
import { useStatus } from "./StatusProvider";
import styles from "./shell.module.css";

const NAV = [
  { href: "/", label: "Control room" },
  { href: "/demo", label: "Demo" },
  { href: "/ledger", label: "Ledger" },
  { href: "/policy", label: "Policy" },
  { href: "/security", label: "Security" },
] as const;

const time = (iso: string | null) => (iso ? iso.slice(11, 19) : "");

export function StatusStrip({ network, verifier, policyVersion, policyHash }: { network: string; verifier: string; policyVersion: number; policyHash: string }) {
  const { live, halting } = useStatus();
  const path = usePathname();
  const halted = live.killSwitch.engaged || live.killSwitch.configFlag;
  const runState = halted ? "Halted" : halting ? "Halting…" : live.run ? `Run ${live.run.runId} writing` : "Idle";

  return (
    <>
      <header className={styles.strip} data-halted={halted} style={{ viewTransitionName: "status-strip" }}>
        <div className={styles.stripInner}>
          <Link href="/" className={styles.mark}>
            Athera Treasury
          </Link>
          <nav aria-label="Main" className={styles.nav}>
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={styles.navLink} aria-current={active ? "page" : undefined}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <dl className={styles.meta}>
            <div>
              <dt>Network</dt>
              <dd>
                {network}, {verifier}
              </dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>
                <Link href="/policy" className="data">
                  v{policyVersion} · {policyHash.slice(0, 6)}
                </Link>
              </dd>
            </div>
            <div>
              <dt>State</dt>
              <dd className={styles.state} data-state={halted ? "halted" : live.run ? "running" : "idle"}>
                {runState}
              </dd>
            </div>
          </dl>
          <div className={styles.stripKill}>
            <KillSwitch placement="strip" />
          </div>
        </div>
        {halted ? (
          <div className={styles.haltBand} role="alert">
            <strong>Halted{live.killSwitch.since ? ` at ${time(live.killSwitch.since)} UTC` : ""}.</strong>{" "}
            {live.killSwitch.configFlag ? "kill_switch is true in config.yaml." : (live.killSwitch.reason ?? "")} No agent signs or submits anything while halted. Release on the
            server with <code className="data">pnpm halt --release</code>.
          </div>
        ) : null}
      </header>
      <div className={styles.bar}>
        <span className={styles.barState} data-state={halted ? "halted" : live.run ? "running" : "idle"}>
          {runState}
        </span>
        <KillSwitch placement="bar" />
      </div>
    </>
  );
}
