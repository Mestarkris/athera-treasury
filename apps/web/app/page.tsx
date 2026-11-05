import { ArrowRight, OctagonX, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { EntrySheetHost } from "../components/ledger/EntrySheetHost";
import { LedgerTable } from "../components/ledger/LedgerTable";
import { buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { PageHeader } from "../components/ui/page-header";
import { readLedger } from "../lib/ledger";
import { getStatus } from "../lib/status";
import { cn } from "../lib/utils";

export const dynamic = "force-dynamic";

function Meter({ label, used, limit, ratio, note }: { label: string; used: string; limit: string; ratio: number; note?: string }) {
  const pct = Math.min(Math.max(ratio, 0), 1);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="data">
          {used} <span className="text-muted-foreground">of</span> {limit}
        </span>
      </div>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        aria-valuetext={`${used} of ${limit}`}
      >
        <span className={cn("block h-full origin-left rounded-full", pct >= 0.8 ? "bg-warning" : "bg-primary")} style={{ transform: `scaleX(${pct})` }} />
      </div>
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="data text-xl font-semibold">{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="text-muted-foreground px-4 text-xs">{hint}</CardContent> : null}
    </Card>
  );
}

function RecentLedger() {
  const { entries } = readLedger();
  const recent = entries.slice(-8).reverse();
  return recent.length ? (
    <LedgerTable caption={`Latest ${recent.length} of ${entries.length} ledger entries`} entries={recent} all={entries} />
  ) : (
    <p className="text-muted-foreground text-sm">The ledger is empty. Run the demo loop to create the first entries.</p>
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Control room"
        description={
          <>
            Agents act only inside{" "}
            <Link href="/policy" className="text-foreground underline underline-offset-4">
              config.yaml
            </Link>
            . Every value moves as a NEAR Intent on {s.network}, and every step is written to the{" "}
            <Link href="/ledger" className="text-foreground underline underline-offset-4">
              ledger
            </Link>
            .
          </>
        }
        actions={
          <>
            <Link href="/demo" className={buttonVariants()}>
              Run demo loop
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link href="/ledger" className={buttonVariants({ variant: "outline" })}>
              Open ledger
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Treasury balance"
          value={s.balance.display ?? "RPC unavailable"}
          hint={s.balance.display ? `inside ${s.verifier}, read ${s.balance.at.slice(11, 19)} UTC` : undefined}
        />
        <Stat label="Moved today" value={s.today.moved.display} hint={`of ${s.today.perDay.display} per day (UTC)`} />
        <Stat label="Policy" value={`v${s.policy.version} · ${s.policy.hash.slice(0, 6)}`} hint="sha256 of config.yaml" />
        <Stat
          label="Ledger"
          value={`${s.ledger.entries} entries`}
          hint={s.ledger.chainOk ? "hash chain intact" : <span className="text-destructive">hash chain broken</span>}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Today against limits</CardTitle>
            <CardDescription>
              UTC day {s.today.date}. Counted from the ledger: every submitted intent counts unless its settlement is recorded as failed.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-6">
            <Meter label={`Capital moved from ${s.treasury}`} used={s.today.moved.display} limit={`${s.today.perDay.display} per day`} ratio={ratio} />
            <Meter
              label="Inference spend"
              used={`$${s.today.inference.usedUsd}`}
              limit={`$${s.today.inference.limitUsd} per day`}
              ratio={inferenceRatio}
              note="The treasury agent is rule-based and makes no model calls, so this stays at zero. The limit is still enforced."
            />
            <p className="text-muted-foreground text-sm">
              Per transaction: <span className="data text-foreground">{s.today.perTx.display}</span> maximum.
            </p>
          </CardContent>
        </Card>

        <Card className={cn(halted && "border-destructive/50")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {halted ? <OctagonX className="text-destructive size-4" aria-hidden="true" /> : <ShieldCheck className="text-success size-4" aria-hidden="true" />}
              Kill switch
            </CardTitle>
            <CardDescription>{halted ? "Engaged" : "Not engaged"}</CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-3 text-sm">
            {halted ? (
              <p className="text-destructive">
                Engaged{s.killSwitch.since ? ` at ${s.killSwitch.since.slice(11, 19)} UTC` : ""}:{" "}
                {s.killSwitch.configFlag ? "kill_switch is true in config.yaml" : s.killSwitch.reason}.
              </p>
            ) : null}
            <p>Hold the control in the header for 1.2 seconds. Every agent stops at its next step and nothing new is signed or submitted.</p>
            <p>An intent already broadcast cannot be recalled. Anything it leaves unfinished is picked up by the next run, through the same policy checks.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent ledger</CardTitle>
          <CardDescription>Newest first. Every row shows its policy hash and how to verify it.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-muted-foreground text-sm">Reading the ledger…</p>}>
            <RecentLedger />
          </Suspense>
        </CardContent>
      </Card>
      <EntrySheetHost />
    </div>
  );
}
