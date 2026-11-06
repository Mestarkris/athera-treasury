import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cache } from "react";
import { readLedgerFile, verifyChain, type LedgerEntry } from "@athera/ledger";
import { PolicyEngine } from "@athera/policy";
import { FileReportStore, type Report } from "@athera/agents";

/** Repo root. `next dev`/`start` run with cwd = apps/web. */
export const ROOT = process.env["ATHERA_ROOT"] ?? resolve(process.cwd(), "../..");
export const LEDGER_PATH = resolve(ROOT, process.env["ATHERA_LEDGER_PATH"] ?? "data/ledger.jsonl");
export const HALT_PATH = resolve(ROOT, "data/HALT");
export const LOCK_PATH = resolve(ROOT, "data/RUN.lock");
export const CONFIG_PATH = resolve(ROOT, "config.yaml");
export const REPORTS_DIR = resolve(ROOT, "data/reports");

const reports = new FileReportStore(REPORTS_DIR);
export const listReports = cache((): Report[] => reports.list());
export const getReport = cache((id: string): Report | undefined => reports.get(id));

/**
 * Whether the run process will find a NEAR AI key. Only presence is checked; the web server
 * never reads the value into memory beyond this line test.
 */
export function aiKeyConfigured(): boolean {
  if (process.env["NEARAI_API_KEY"]) return true;
  const p = resolve(ROOT, ".env");
  if (!existsSync(p)) return false;
  return readFileSync(p, "utf8").split("\n").some((l) => /^NEARAI_API_KEY=\S+/.test(l.trim()));
}

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
  if (e.type === "sale") {
    const deposit = (e.payload as { deposit_address?: string } | undefined)?.deposit_address;
    return {
      onChain: true as const,
      explorer: r.explorer ?? [],
      rpc: deposit ? `curl -s 'https://1click.chaindefuser.com/v0/status?depositAddress=${deposit}'` : "",
      expect: [
        "1Click reports status SUCCESS for the quote's deposit address",
        "swapDetails.nearTxHashes lists the transactions above; they are submitted by 1Click's solver relay, not by Athera",
        `the revenue account's balance of the settle asset inside intents.near rose by ${e.amount?.display ?? "the sale amount"}`,
      ],
    };
  }
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
