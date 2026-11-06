"use client";

import Link from "next/link";
import { cn } from "../../lib/utils";
import { Dot } from "../ui/badge";
import { KillSwitch } from "./KillSwitch";
import { MenuDrawer } from "./MenuDrawer";
import { useStatus } from "./StatusProvider";

const time = (iso: string | null) => (iso ? iso.slice(11, 19) : "");

/**
 * Navbar (design system §4.1): wordmark left; network pill, kill switch and Menu right. The kill
 * switch is in the navbar on every page from tablet up, and pinned bottom-right on phones (§4.7).
 */
export function StatusStrip({ network, verifier, policyVersion, policyHash }: { network: string; verifier: string; policyVersion: number; policyHash: string }) {
  const { live, halting } = useStatus();
  const halted = live.killSwitch.engaged || live.killSwitch.configFlag;
  const state = halted ? "halted" : halting ? "halting" : live.run ? "running" : "idle";
  const stateLabel = halted ? "Halted" : halting ? "Halting…" : live.run ? "Running" : network;

  return (
    <>
      <header className="bg-background sticky top-0 pt-[env(safe-area-inset-top)]" style={{ zIndex: "var(--z-sticky)", viewTransitionName: "status-strip" }}>
        <div className="shell flex h-[72px] items-center gap-3 sm:h-20">
          <Link href="/" className="serif-accent text-[30px] leading-none font-semibold" aria-label="Athera Treasury, control room">
            Athera
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <span
              className="bg-surface-1 inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-medium"
              title={`${network} · ${verifier}${live.run ? ` · run ${live.run.runId}` : ""}`}
              role="status"
            >
              <Dot tone={state === "halted" ? "block" : state === "idle" ? "pass" : "pending"} className={cn(state === "running" && "animate-pulse")} />
              <span className={cn(state === "halted" && "text-destructive", (state === "running" || state === "halting") && "text-warning")}>{stateLabel}</span>
            </span>
            <div className="hidden sm:block">
              <KillSwitch />
            </div>
            <MenuDrawer policyVersion={policyVersion} policyHash={policyHash} />
          </div>
        </div>
        {halted ? (
          <div role="alert" className="bg-destructive dark:text-background text-white">
            <p className="shell flex min-h-9 items-center py-1.5 text-sm">
              <span>
                <strong>Halted{live.killSwitch.since ? ` at ${time(live.killSwitch.since)} UTC` : ""}.</strong>{" "}
                {live.killSwitch.configFlag ? "kill_switch is true in config.yaml." : (live.killSwitch.reason ?? "")} No agent signs or submits anything. Release on the
                server with <code className="data">pnpm halt --release</code>.
              </span>
            </p>
          </div>
        ) : null}
      </header>
      {/* Phones: the kill switch sits in the thumb zone, bottom-right. */}
      <div className="fixed right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] sm:hidden" style={{ zIndex: "var(--z-killswitch)" }}>
        <KillSwitch floating />
      </div>
    </>
  );
}
