// pnpm demo           — full loop on NEAR mainnet (tiny amounts; docs/decisions.md D1)
// pnpm demo --halt    — same, but a SEPARATE OS process engages the kill switch mid-loop
// --mode=loop         — custody, reconcile, valid loop only (used by the web UI)
// --mode=invalid      — the invalid action only: a policy block, nothing signed (web UI)
// --mode=sale         — the business loop: sell a treasury report, paid via 1Click in USDC,
//                       revenue split, AI report written (needs NEARAI_API_KEY in .env)
// --subject=<account> — the account the report is about (default: the treasury)
// --mode=report --sale=<ledger id> — write the report for a paid sale that has none (no payment)
// --run-id=<id>       — run id prefix chosen by the caller so the UI can follow it live
//
// Order: custody preflight → reconcile leftovers → invalid action (blocked) → valid loop
// (principal → fee → revenue split). Prints explorer + ledger links for every settlement.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseUnits } from "@athera/policy";
import type { LedgerEntry } from "@athera/ledger";
import { newRunId } from "@athera/agents";
import { acquireRunLock } from "./lock.ts";
import { HALT_PATH, LEDGER_PATH, LOCK_PATH, REPORT_MODEL, ROOT, wire } from "./wire.ts";

const t0 = Date.now();
const haltMode = process.argv.includes("--halt");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const mode = arg("mode") ?? "all";
if (!["all", "loop", "invalid", "sale", "report"].includes(mode)) throw new Error(`unknown --mode=${mode}`);
const runId = arg("run-id") ?? newRunId();
if (!/^r[0-9a-z]{8,24}$/.test(runId)) throw new Error("bad --run-id");
const base = (process.env["ATHERA_PUBLIC_URL"] || "http://localhost:3000").replace(/\/$/, "");
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
const line = (e: LedgerEntry) => `  ${e.id}  ${e.type.padEnd(16)} ${e.result.padEnd(9)} ${e.summary}`;

const lock = acquireRunLock(LOCK_PATH, runId);
const w = wire();
const cfg = w.policy.config;
const asset = cfg.approved.assets[0];
const vendor = cfg.counterparties.find((c) => c.role === "vendor")?.account;
const decimals = cfg.assets.find((a) => a.id === asset)?.decimals;
if (!asset || !vendor || decimals === undefined) throw new Error("config.yaml needs an approved asset and a vendor counterparty");
if (w.killSwitch.state().engaged) {
  console.error(`Kill switch is ENGAGED (${w.killSwitch.state().reason}). Release with: pnpm halt --release`);
  process.exit(2);
}

console.log(`Athera Treasury demo · ${cfg.network} · ${cfg.verifier} · policy v${w.policy.ref.version} · ${w.policy.ref.hash.slice(0, 6)}${haltMode ? " · HALT MODE" : ""}\n`);

console.log("1 custody");
const custody = await w.preflight();
for (const [role, c] of Object.entries(custody)) console.log(`  ${role.padEnd(9)}${c.account}  ${c.scope}`);

if (mode === "invalid") {
  const bad = await w.orchestrator.run({ to: vendor, asset, amount: parseUnits("1.2", decimals).toString(), reason: "demo: over the per-tx limit" }, runId);
  for (const e of bad.entries) console.log(line(e));
  lock.release();
  process.exit(bad.status === "blocked" ? 0 : 1);
}

console.log(`\n2 reconcile unfinished accounting  [${secs()}s]`);
const rec = await w.orchestrator.reconcile(`${runId}c`);
if (rec.handled === 0) console.log("  nothing pending");
for (const e of rec.entries) console.log(line(e));
if (rec.status !== "completed") {
  console.error(`  reconcile ${rec.status}; stopping`);
  process.exit(1);
}

if (mode === "report") {
  const saleId = arg("sale");
  if (!saleId) throw new Error("--mode=report needs --sale=<ledger id of the confirmed sale>");
  console.log(`\n3 report for sale ${saleId} (no payment; one metered AI call)  [${secs()}s]`);
  const r = await w.orchestrator.retryReport(saleId, runId);
  for (const e of r.entries) console.log(line(e));
  if (r.status === "completed" && r.reportId) console.log(`  report        ${base}/reports/${r.reportId}`);
  console.log(`\n${r.status.toUpperCase()}${r.status === "failed" ? `: ${r.error}` : ""} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  lock.release();
  process.exit(r.status === "completed" ? 0 : 1);
}

if (mode === "sale") {
  if (!w.ai.hasKey) {
    console.error("NEARAI_API_KEY is not set in .env; the analyst cannot write the report. See docs/setup.md.");
    lock.release();
    process.exit(2);
  }
  // Before any money moves: one tiny metered call proves the AI account can actually be billed,
  // so a customer never pays for a report that cannot be written.
  const { meteredChat } = await import("@athera/agents");
  try {
    const probe = await meteredChat(
      { policy: w.policy, ledger: w.ledger, killSwitch: w.killSwitch, ai: w.ai },
      { runId, proposalId: `${runId}-probe`, agent: "analyst", purpose: "AI availability check before the sale", model: process.env["ATHERA_REPORT_MODEL"] || REPORT_MODEL, messages: [{ role: "user", content: "Reply OK." }], maxTokens: 4 },
    );
    if (probe.kind === "blocked") throw new Error(probe.check.summary);
  } catch (e) {
    console.error(`AI is not available, so no sale was started and nothing was paid: ${String(e).slice(0, 240)}`);
    lock.release();
    process.exit(2);
  }
  const subject = arg("subject") ?? cfg.accounts.treasury;
  console.log(`\n3 sale: ${cfg.sales?.product} on ${subject}, paid by ${cfg.accounts.treasury} via 1Click  [${secs()}s]`);
  const sale = await w.orchestrator.runSale({ customer: cfg.accounts.treasury, subject }, runId);
  for (const e of sale.entries) console.log(line(e));
  for (const e of sale.entries.filter((x) => x.type === "settlement" || x.type === "sale")) {
    for (const url of e.refs?.explorer ?? []) console.log(`  ${e.type.padEnd(13)} ${url}`);
  }
  if (sale.status === "completed" && sale.reportId) console.log(`  report        ${base}/reports/${sale.reportId}`);
  console.log(`  ledger JSON   ${base}/api/ledger?run=${sale.runId}`);
  const total = (Date.now() - t0) / 1000;
  console.log(`\n${sale.status.toUpperCase()}${sale.status === "failed" ? `: ${sale.error}` : ""} · ${total.toFixed(1)}s${total > 120 ? " · OVER the 2-minute budget" : ""}`);
  lock.release();
  process.exit(sale.status === "completed" ? 0 : 1);
}

if (mode === "all") {
console.log(`\n3 invalid action  [${secs()}s]`);
const signsBefore = w.signers.reduce((s, x) => s + x.calls, 0);
const bad = await w.orchestrator.run({ to: vendor, asset, amount: parseUnits("1.2", decimals).toString(), reason: "demo: over the per-tx limit" }, `${runId}i`);
for (const e of bad.entries) console.log(line(e));
const signsAfter = w.signers.reduce((s, x) => s + x.calls, 0);
console.log(`  → ${bad.status}; signer calls ${signsAfter - signsBefore}; intents created ${bad.entries.filter((e) => e.type === "intent_created").length}`);
if (bad.status !== "blocked" || signsAfter !== signsBefore) process.exit(1);
}

console.log(`\n4 valid loop: principal → fee → revenue split  [${secs()}s]`);
let haltProc: ReturnType<typeof spawn> | undefined;
const unsub = haltMode
  ? w.ledger.subscribe((e) => {
      if (e.type === "intent_submitted" && !haltProc) {
        // A separate process, exactly like an operator running `pnpm halt` in another terminal.
        haltProc = spawn(process.execPath, ["--import", "tsx", resolve(ROOT, "scripts/demo/halt.ts"), `operator halt from separate process (pid ${process.pid} demo)`], {
          cwd: ROOT,
          stdio: "ignore",
        });
      }
    })
  : () => {};
// When the halt process is spawned, give it time to write the flag before the loop's next stage check.
if (haltMode) {
  const origTrack = w.settlement.track.bind(w.settlement);
  w.settlement.track = async (sub) => {
    const r = await origTrack(sub);
    if (haltProc) await new Promise<void>((res) => (haltProc?.exitCode !== null ? res() : haltProc?.once("exit", () => res())));
    return r;
  };
}
const run = await w.orchestrator.run({ to: vendor, asset, amount: parseUnits("0.01", decimals).toString(), reason: "demo: pay approved vendor" }, runId);
unsub();
for (const e of run.entries) console.log(line(e));

console.log(`\n5 verify  [${secs()}s]`);
for (const e of run.entries.filter((x) => x.type === "settlement" || x.type === "halt" || x.type === "policy_check")) {
  const r = e.refs ?? {};
  console.log(`  ${e.type.padEnd(13)} ${base}/ledger/${e.id}`);
  if (r.tx_hash) console.log(`  ${"".padEnd(13)} ${r.explorer?.[0] ?? ""}   intent_hash ${r.intent_hash}   memo ${r.memo}`);
}
console.log(`  ledger JSON   ${base}/api/ledger?run=${run.runId}`);
console.log(`  re-check every settlement from public RPC: pnpm verify`);

const total = (Date.now() - t0) / 1000;
console.log(`\n${run.status.toUpperCase()}${run.status === "halted" ? ` before "${run.stage}" (kill switch; flag at ${HALT_PATH})` : ""} · ${total.toFixed(1)}s${total > 120 ? " · OVER the 2-minute budget" : ""} · ledger ${LEDGER_PATH}`);
if (run.status === "halted") console.log("Release with: pnpm halt --release   (the next pnpm demo reconciles the unfinished fee and split)");
lock.release();
process.exit(haltMode ? (run.status === "halted" ? 0 : 1) : run.status === "completed" ? 0 : 1);
