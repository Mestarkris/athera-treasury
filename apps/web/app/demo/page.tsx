import { Card, CardContent } from "../../components/ui/card";
import { PageHeader } from "../../components/ui/page-header";
import { expectedFee, fmt, parseUnits } from "@athera/policy";
import { loadPolicy, readLedger } from "../../lib/ledger";
import { DemoConsole } from "./DemoConsole";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo" };

export default function DemoPage() {
  const { entries } = readLedger();
  // The most recent run that started with a treasury proposal (skip reconcile-only runs).
  // Prefer the most recent complete loop (it shows all seven stages); fall back to the latest run.
  const lastRunId =
    entries.findLast((e) => e.type === "payout" && entries.some((x) => x.run_id === e.run_id && x.type === "proposal" && x.agent === "treasury"))?.run_id ??
    entries.findLast((e) => e.type === "proposal" && e.agent === "treasury")?.run_id;
  const lastRun = lastRunId ? entries.filter((e) => e.run_id === lastRunId) : [];
  // Same figures scripts/demo/run.ts uses: 0.01 of the first approved asset, fee per policy.
  const cfg = loadPolicy().config;
  const asset = cfg.approved.assets[0] ?? "";
  const decimals = cfg.assets.find((a) => a.id === asset)?.decimals ?? 24;
  const principal = parseUnits("0.01", decimals);
  const fee = expectedFee(cfg, asset, principal);
  const cost = {
    principal: fmt(cfg, asset, principal),
    fee: fmt(cfg, asset, fee),
    total: fmt(cfg, asset, principal + fee),
    vendor: cfg.counterparties.find((c) => c.role === "vendor")?.account ?? "the approved vendor",
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Demo loop"
        description="One real loop on NEAR mainnet: the treasury proposes, policy checks it, the settlement agent signs and submits a NEAR Intent, the verifier settles it, accounting collects the fee and pays the revenue split. Each stage lights up only when its entry is written to the ledger."
      />
      <Card>
        <CardContent>
          <DemoConsole lastRun={lastRun} cost={cost} />
        </CardContent>
      </Card>
    </div>
  );
}
