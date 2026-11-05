// Independent check: re-verifies the ledger hash chain, then re-reads every settled tx from the
// chain (no private logs) and confirms the dip4 events carry the ledger's intent_hash and memo.
import { readLedgerFile, verifyChain } from "@athera/ledger";
import { NearRpc, DEFAULT_MAINNET_RPCS, parseDip4 } from "@athera/settlement";
import { PolicyEngine } from "@athera/policy";
import { deriveState } from "@athera/agents";
import { CONFIG_PATH, LEDGER_PATH } from "./wire.ts";

// Every execute_intents tx is submitted by the treasury's function-call key (docs/decisions.md D4).
const submitter = PolicyEngine.load(CONFIG_PATH).config.accounts.treasury;

const entries = readLedgerFile(LEDGER_PATH);
console.log(`ledger ${entries.length} entries · chain ${JSON.stringify(verifyChain(entries))}`);
const rpc = new NearRpc(process.env["NEAR_RPC_URL"] || DEFAULT_MAINNET_RPCS);
let bad = 0;
for (const e of entries.filter((x) => x.type === "settlement" && x.result === "confirmed")) {
  const r = e.refs!;
  const tx = await rpc.txStatus(r.tx_hash!, submitter);
  const events = tx.receipts_outcome.flatMap((o) => o.outcome.logs.map(parseDip4).filter((x) => x !== undefined).map((ev) => ({ ev, block: o.block_hash })));
  const mine = events.filter(({ ev }) => ev.data.some((d) => d["intent_hash"] === r.intent_hash));
  const transfers = mine.filter(({ ev }) => ev.event === "transfer").flatMap(({ ev }) => ev.data);
  const memoOk = transfers.length > 0 && transfers.every((d) => d["memo"] === r.memo);
  const failed = [tx.transaction_outcome, ...tx.receipts_outcome].some((o) => typeof o.outcome.status === "object" && "Failure" in o.outcome.status);
  const height = (await rpc.block({ block_id: mine[0]?.block ?? "" })).header.height;
  const ok = !failed && mine.length > 0 && memoOk && height === r.block_height && tx.transaction.receiver_id === "intents.near";
  if (!ok) bad++;
  console.log(`${ok ? "OK " : "BAD"} ${e.id} tx ${r.tx_hash} signer ${tx.transaction.signer_id} → ${tx.transaction.receiver_id} · block ${height}${height === r.block_height ? "" : ` (ledger says ${r.block_height})`} · events ${mine.map(({ ev }) => ev.event).join("+")} · memo ${memoOk ? "match" : "MISMATCH"}`);
  for (const d of transfers) console.log(`      ${String(d["account_id"])} → ${String(d["receiver_id"])} ${JSON.stringify(d["tokens"])}`);
}
// Re-run every recorded policy check (pass AND block) from the ledger alone: the proposal from
// the upstream entry, state rebuilt from the ledger prefix plus the balance snapshot the check
// recorded, and config.yaml at the recorded policy hash. Results and per-rule statuses must match.
const engine = PolicyEngine.load(CONFIG_PATH);
let rechecked = 0;
let skipped = 0;
const byId = new Map(entries.map((e) => [e.id, e]));
for (const e of entries.filter((x) => x.type === "policy_check")) {
  if (e.policy.hash !== engine.ref.hash) {
    skipped++; // older policy version: needs config.yaml at that hash from git history
    continue;
  }
  const payload = e.payload as { rules: { rule: string; status: string }[]; balances?: Record<string, string>; proposal?: unknown };
  const proposal = payload.proposal ?? byId.get(e.upstream?.[0] ?? "")?.payload;
  const halted = payload.rules.some((r) => r.rule === "kill_switch" && r.status === "block");
  const balances = Object.fromEntries(Object.entries(payload.balances ?? {}).map(([k, v]) => [k, BigInt(v)]));
  const state = deriveState(entries.slice(0, e.seq), balances, halted, new Date(e.ts));
  const again = engine.validate(proposal, state);
  const same = again.result === e.result && JSON.stringify(again.rules.map((r) => [r.rule, r.status])) === JSON.stringify(payload.rules.map((r) => [r.rule, r.status]));
  if (!same) {
    bad++;
    console.log(`BAD ${e.id} policy_check recorded ${e.result}, recomputed ${again.result}: ${again.summary}`);
  }
  rechecked++;
}
console.log(`policy checks recomputed from the ledger: ${rechecked} match${bad ? " (see BAD above)" : ""}${skipped ? `, ${skipped} skipped (older policy version)` : ""}`);
process.exit(bad ? 1 : 0);
