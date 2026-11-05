import "server-only";
import { resolve } from "node:path";
import { cache } from "react";
import { readLedgerFile, verifyChain, type LedgerEntry } from "@athera/ledger";
import { PolicyEngine } from "@athera/policy";

/** Repo root. `next dev`/`start` run with cwd = apps/web. */
export const ROOT = process.env["ATHERA_ROOT"] ?? resolve(process.cwd(), "../..");
export const LEDGER_PATH = resolve(ROOT, process.env["ATHERA_LEDGER_PATH"] ?? "data/ledger.jsonl");
export const HALT_PATH = resolve(ROOT, "data/HALT");
export const LOCK_PATH = resolve(ROOT, "data/RUN.lock");
export const CONFIG_PATH = resolve(ROOT, "config.yaml");

/** Read fresh per request (deduplicated within one render); another process appends to it. */
export const readLedger = cache((): { entries: LedgerEntry[]; chain: ReturnType<typeof verifyChain> } => {
  const entries = readLedgerFile(LEDGER_PATH);
  return { entries, chain: verifyChain(entries) };
});

export const loadPolicy = cache(() => PolicyEngine.load(CONFIG_PATH));

export function currentPolicy() {
  const p = loadPolicy();
  return {
    version: p.ref.version,
    hash: p.ref.hash,
    network: p.config.network,
    verifier: p.config.verifier,
    /** Every execute_intents tx is submitted by the treasury's function-call key. */
    submitter: p.config.accounts.treasury,
  };
}

export const RPC_FOR_VERIFY = "https://rpc.mainnet.fastnear.com";

/** Copy-pasteable, dependency-free ways to check an entry against the chain. */
export function howToVerify(e: LedgerEntry, submitter: string) {
  const r = e.refs ?? {};
  if (!r.tx_hash) {
    return {
      onChain: false as const,
      note:
        e.type === "policy_check" && e.result === "block"
          ? "Blocked before any intent existed, so there is deliberately nothing on-chain. Recompute the check from the proposal, the recorded balance snapshot and config.yaml at this policy hash (pnpm verify does this for every check)."
          : "This entry has no on-chain counterpart of its own. Follow upstream or downstream to one that does.",
    };
  }
  return {
    onChain: true as const,
    explorer: r.explorer ?? [],
    rpc: `curl -s ${RPC_FOR_VERIFY} -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"${r.tx_hash}","sender_account_id":"${submitter}","wait_until":"FINAL"}}'`,
    expect: [
      "transaction.receiver_id is intents.near and every receipt outcome is a Success",
      r.intent_hash ? `a receipt log EVENT_JSON with standard "dip4" whose data[].intent_hash is ${r.intent_hash}` : undefined,
      r.memo ? `transfer events carry memo "${r.memo}" (proposal id + first 8 hex of the policy hash)` : undefined,
      r.block_height ? `that receipt is in block ${r.block_height}` : undefined,
      "or run `pnpm verify` in the repo, which performs all of the above for every settlement",
    ].filter((x): x is string => Boolean(x)),
  };
}
