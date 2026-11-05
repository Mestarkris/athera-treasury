"use client";

import { OctagonX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { KillSwitch } from "./KillSwitch";
import { useStatus } from "./StatusProvider";

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
  const state = halted ? "halted" : halting ? "halting" : live.run ? "running" : "idle";
  const stateLabel = halted ? "Halted" : halting ? "Halting…" : live.run ? `Run ${live.run.runId}` : "Idle";

  return (
    <>
      <header
        className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 border-b pt-[env(safe-area-inset-top)] backdrop-blur"
        style={{ zIndex: "var(--z-sticky)", viewTransitionName: "status-strip" }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:px-6 lg:h-14 lg:flex-nowrap lg:py-0">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
            <span aria-hidden="true" className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md text-xs font-bold">
              A
            </span>
            Athera Treasury
          </Link>
          <div className="ml-auto flex items-center gap-2 lg:order-3">
            <Link href="/policy" className="hidden sm:block">
              <Badge variant="outline" className="data font-normal">
                Policy v{policyVersion} · {policyHash.slice(0, 6)}
              </Badge>
            </Link>
            <Badge
              variant={state === "halted" ? "danger" : state === "running" || state === "halting" ? "warning" : "outline"}
              className="font-normal"
              title={`${network}, ${verifier}`}
            >
              <span aria-hidden="true" className={cn("size-1.5 rounded-full bg-current", state === "idle" && "bg-success")} />
              {stateLabel}
            </Badge>
            <div className="hidden lg:block">
              <KillSwitch />
            </div>
          </div>
          <nav aria-label="Main" className="-mx-2 flex basis-full gap-1 overflow-x-auto [scrollbar-width:none] lg:order-2 lg:mx-0 lg:basis-auto">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "text-muted-foreground hover:text-foreground hover:bg-accent inline-flex h-9 items-center rounded-md px-3 text-sm whitespace-nowrap transition-colors pointer-coarse:h-11",
                    active && "bg-accent text-foreground font-medium",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {halted ? (
          <div role="alert" className="border-destructive/30 bg-destructive/10 border-t">
            <div className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2 text-sm sm:px-6">
              <OctagonX className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                <strong className="text-destructive">Halted{live.killSwitch.since ? ` at ${time(live.killSwitch.since)} UTC` : ""}.</strong>{" "}
                {live.killSwitch.configFlag ? "kill_switch is true in config.yaml." : (live.killSwitch.reason ?? "")} No agent signs or submits anything while halted.
                Release on the server with <code className="data">pnpm halt --release</code>.
              </p>
            </div>
          </div>
        ) : null}
      </header>
      {/* Phones and tablets: the kill switch lives in the thumb zone. */}
      <div
        className="bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
        style={{ zIndex: "var(--z-killswitch)" }}
      >
        <span className={cn("text-muted-foreground truncate text-xs", state === "halted" && "text-destructive font-medium", state === "running" && "text-warning font-medium")}>
          {stateLabel}
        </span>
        <KillSwitch />
      </div>
    </>
  );
}
