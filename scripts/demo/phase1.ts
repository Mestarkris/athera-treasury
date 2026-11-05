// Phase 1 proofs on NEAR mainnet (tiny amounts; see docs/decisions.md D1).
//   P1 custody: runtime holds only scoped keys
//   P2 invalid proposal blocked before intent creation; signer call count stays 0
//   P3 valid proposal → NEAR Intent → tracked to final settlement
//   P4 settlement logged in the ledger, matchable on-chain by tx hash, intent_hash and memo
//   P5 kill switch halts a running loop; the halt is in the ledger
import { parseUnits } from "@athera/policy";
import type { LedgerEntry } from "@athera/ledger";
import { acquireRunLock } from "./lock.ts";
import { LEDGER_PATH, LOCK_PATH, wire } from "./wire.ts";

const t0 = Date.now();
const lock = acquireRunLock(LOCK_PATH, "phase1");
const w = wire();
const cfg = w.policy.config;
const asset = cfg.approved.assets[0];
const vendor = cfg.counterparties.find((c) => c.role === "vendor")?.account;
if (!asset || !vendor) throw new Error("config.yaml needs an approved asset and a vendor counterparty");
const decimals = cfg.assets.find((a) => a.id === asset)?.decimals ?? 24;
const signs = () => w.signers.reduce((s, x) => s + x.calls, 0);
const line = (e: LedgerEntry) => `    ${e.id}  ${e.type.padEnd(16)} ${e.result.padEnd(9)} ${e.summary}`;
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

if (w.killSwitch.state().engaged) throw new Error("halt flag is engaged; run `pnpm halt --release` first");

console.log(`Athera Treasury · Phase 1 proofs · ${cfg.network} · policy v${w.policy.ref.version} · ${w.policy.ref.hash.slice(0, 6)}\n`);

console.log("P1 custody");
const custody = await w.preflight();
for (const [role, c] of Object.entries(custody)) console.log(`    ${role.padEnd(9)}${c.account}  ${c.publicKey}\n             ${c.scope}`);

console.log(`\nP2 invalid proposal (over per-tx limit)`);
const before = signs();
const blocked = await w.orchestrator.run({ to: vendor, asset, amount: parseUnits("1.2", decimals).toString(), reason: "phase1 invalid: over per-tx limit" });
for (const e of blocked.entries) console.log(line(e));
console.log(`    status ${blocked.status} · signer calls during run: ${signs() - before} · intent entries: ${blocked.entries.filter((e) => e.type.startsWith("intent")).length}`);
if (blocked.status !== "blocked" || signs() !== before) throw new Error("P2 FAILED");

console.log(`\nP3+P4 valid proposal → intent → settlement (principal, fee, split)  [${elapsed()}]`);
const ok = await w.orchestrator.run({ to: vendor, asset, amount: parseUnits("0.01", decimals).toString(), reason: "phase1 valid: pay demo vendor" });
for (const e of ok.entries) console.log(line(e));
if (ok.status !== "completed") throw new Error(`P3 FAILED: ${ok.status}${"error" in ok ? ` ${ok.error}` : ""}`);
for (const e of ok.entries.filter((x) => x.type === "settlement")) {
  console.log(`    verify ${e.refs?.explorer?.[0]}   intent_hash ${e.refs?.intent_hash}   memo ${e.refs?.memo}`);
}

console.log(`\nP5 kill switch mid-loop  [${elapsed()}]`);
const unsub = w.ledger.subscribe((e) => {
  if (e.type === "intent_submitted") w.killSwitch.engage("phase1: operator halt while the principal settles");
});
const halted = await w.orchestrator.run({ to: vendor, asset, amount: parseUnits("0.01", decimals).toString(), reason: "phase1 kill-switch run" });
unsub();
w.killSwitch.release();
for (const e of halted.entries) console.log(line(e));
console.log(`    status ${halted.status}${halted.status === "halted" ? ` before "${halted.stage}"` : ""}`);
if (halted.status !== "halted") throw new Error("P5 FAILED");

lock.release();
console.log(`\nledger ${LEDGER_PATH} · ${w.ledger.all().length} entries · total ${elapsed()}`);
