import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { EntrySheetHost } from "../components/ledger/EntrySheetHost";
import { LedgerTable } from "../components/ledger/LedgerTable";
import { Hero } from "../components/hero/Hero";
import { Dot } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { loadPolicy, readLedger } from "../lib/ledger";
import { getStatus } from "../lib/status";
import { cn } from "../lib/utils";

export const dynamic = "force-dynamic";

function Meter({ label, used, limit, ratio, note }: { label: string; used: string; limit: string; ratio: number; note?: string }) {
  const pct = Math.min(Math.max(ratio, 0), 1);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="num">
          {used} <span className="text-muted-foreground">of</span> {limit}
        </span>
      </div>
      <div
        className="bg-surface-2 h-1 overflow-hidden rounded-full"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        aria-valuetext={`${used} of ${limit}`}
      >
        <span className={cn("block h-full origin-left rounded-full", pct >= 0.8 ? "bg-pending-dot" : "bg-foreground")} style={{ transform: `scaleX(${pct})` }} />
      </div>
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
    </div>
  );
}

/** Large-type amounts: 4 decimals for reading; the exact value stays in the title and the ledger. */
function short(display: string | null): string | null {
  if (!display) return display;
  const m = /^(\d+)\.(\d+)(.*)$/.exec(display);
  if (!m || m[2]!.length <= 4) return display;
  return `${Number(`${m[1]}.${m[2]}`).toFixed(4)}${m[3]}`;
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid content-start gap-1 border-t border-border pt-4">
      <span className="text-muted-foreground text-[13px] font-medium">{label}</span>
      <span className="num text-[22px] leading-tight font-semibold tracking-[-0.03em] [overflow-wrap:anywhere]">{value}</span>
      {hint ? <span className="text-muted-2 text-xs font-medium">{hint}</span> : null}
    </div>
  );
}

/** What the code actually runs on (design system §4.4: no logos, no "trusted by"). */
const BUILT_ON = [
  { name: "NEAR Protocol", href: "https://docs.near.org" },
  { name: "NEAR Intents", href: "https://docs.near-intents.org" },
  { name: "1Click", href: "https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api" },
  { name: "NEAR AI Cloud", href: "https://docs.near.ai" },
  { name: "TypeScript", href: "https://www.typescriptlang.org/docs/" },
  { name: "Next.js", href: "https://nextjs.org/docs" },
];

function BuiltOn() {
  return (
    <section aria-labelledby="built-on" className="flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:gap-10">
      <h2 id="built-on" className="text-muted-foreground max-w-[163px] text-sm font-medium tracking-[-0.01em]">
        Built on infrastructure you can verify
      </h2>
      <ul className="flex flex-wrap gap-x-8 gap-y-2">
        {BUILT_ON.map((b) => (
          <li key={b.name}>
            <a href={b.href} target="_blank" rel="noreferrer" className="text-base font-semibold tracking-[-0.02em] hover:underline hover:underline-offset-4">
              {b.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function RecentLedger() {
  const { entries } = await readLedger();
  const recent = entries.slice(-5).reverse();
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

  const policy = await loadPolicy();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12">
      <Hero cfg={policy.config} policy={{ version: s.policy.version, hash: s.policy.hash }} halted={halted} network={s.network} />

      <section aria-labelledby="latest" className="relative -mt-28 grid gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="latest" className="text-[22px] font-semibold tracking-[-0.03em]">
            Latest on the ledger
          </h2>
          <Link href="/ledger" className="text-muted-foreground hover:text-foreground text-sm font-medium">
            All {s.ledger.entries} entries
          </Link>
        </div>
        <Suspense fallback={<p className="text-muted-foreground text-sm">Reading the ledger…</p>}>
          <RecentLedger />
        </Suspense>
      </section>

      <BuiltOn />

      <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Stat
          label="Treasury balance"
          value={<span title={s.balance.display ?? undefined}>{short(s.balance.display) ?? "RPC unavailable"}</span>}
          hint={s.balance.display ? `inside ${s.verifier}, read ${s.balance.at.slice(11, 19)} UTC` : undefined}
        />
        <Stat label="Moved today" value={<span title={s.today.moved.display}>{short(s.today.moved.display)}</span>} hint={`of ${s.today.perDay.display} per day (UTC)`} />
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
            <Meter label={`Capital moved from ${s.treasury}`} used={short(s.today.moved.display) ?? ""} limit={`${s.today.perDay.display} per day`} ratio={ratio} />
            <Meter
              label="Inference spend"
              used={`$${s.today.inference.usedUsd}`}
              limit={`$${s.today.inference.limitUsd} per day`}
              ratio={inferenceRatio}
              note="Billed NEAR AI Cloud cost of today's analyst calls, from the ledger. Each call is checked against this budget before it is made."
            />
            <p className="text-muted-foreground text-sm">
              Per transaction: <span className="num text-foreground">{s.today.perTx.display}</span> maximum.
            </p>
          </CardContent>
        </Card>

        <Card className={cn(halted && "border-destructive")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Kill switch</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <Dot tone={halted ? "block" : "pass"} />
              <span className={halted ? "text-destructive" : "text-success"}>{halted ? "Engaged" : "Armed"}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-3 text-sm">
            {halted ? (
              <p className="text-destructive">
                Engaged{s.killSwitch.since ? ` at ${s.killSwitch.since.slice(11, 19)} UTC` : ""}:{" "}
                {s.killSwitch.configFlag ? "kill_switch is true in config.yaml" : s.killSwitch.reason}.
              </p>
            ) : null}
            <p>Hold the kill switch in the navbar (bottom-right on a phone) for 1.2 seconds. Every agent stops at its next step and nothing new is signed or submitted.</p>
            <p>An intent already broadcast cannot be recalled. Anything it leaves unfinished is picked up by the next run, through the same policy checks.</p>
          </CardContent>
        </Card>
      </div>

      <EntrySheetHost />
    </div>
  );
}
