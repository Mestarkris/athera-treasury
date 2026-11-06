import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cache } from "react";
import { readLedgerFile, verifyChain, type LedgerEntry } from "@athera/ledger";
import { PolicyEngine } from "@athera/policy";
import { FileReportStore, type Report } from "@athera/agents";
import { AtheraStore, K, type AgentMeta } from "@athera/store";

/** Repo root. `next dev`/`start` run with cwd = apps/web. */
export const ROOT = process.env["ATHERA_ROOT"] ?? resolve(process.cwd(), "../..");
export const LEDGER_PATH = resolve(ROOT, process.env["ATHERA_LEDGER_PATH"] ?? "data/ledger.jsonl");
export const HALT_PATH = resolve(ROOT, "data/HALT");
export const LOCK_PATH = resolve(ROOT, "data/RUN.lock");
export const CONFIG_PATH = resolve(ROOT, "config.yaml");
export const REPORTS_DIR = resolve(ROOT, "data/reports");

/**
 * Where the site reads from. Locally (no store credentials) it reads the files the agent writes.
 * Hosted (Vercel) it reads what the local worker publishes into the store; see docs/hosting.md.
 */
export const store = AtheraStore.fromEnv();
export const hosted = store !== null;

const reports = new FileReportStore(REPORTS_DIR);
export const listReports = cache(async (): Promise<Report[]> =>
  store ? (await store.hvalues<Report>(K.reports)).sort((a, b) => b.created_at.localeCompare(a.created_at)) : reports.list(),
);
export const getReport = cache(async (id: string): Promise<Report | undefined> => (store ? ((await store.hget<Report>(K.reports, id)) ?? undefined) : reports.get(id)));

/** The worker's last check-in (hosted only). */
export const agentMeta = cache(async (): Promise<AgentMeta | null> => (store ? store.agent() : null));
/** A worker that has not checked in for this long is shown as offline. */
export const AGENT_STALE_MS = 3 * 60_000;
export const agentOnline = (m: AgentMeta | null) => (hosted ? Boolean(m && Date.now() - Date.parse(m.seen_at) < AGENT_STALE_MS) : true);

/**
 * Whether the run process will find a NEAR AI key. Only presence is checked; the web server
 * never reads the value into memory beyond this line test. Hosted: as reported by the worker.
 */
export async function aiKeyConfigured(): Promise<boolean> {
  if (store) return Boolean((await agentMeta())?.ai_key);
  if (process.env["NEARAI_API_KEY"]) return true;
  const p = resolve(ROOT, ".env");
  if (!existsSync(p)) return false;
  return readFileSync(p, "utf8").split("\n").some((l) => /^NEARAI_API_KEY=\S+/.test(l.trim()));
}

/** Read fresh per request (deduplicated within one render); another process appends to it. */
export const readLedger = cache(async (): Promise<{ entries: LedgerEntry[]; chain: ReturnType<typeof verifyChain> }> => {
  const entries = store ? await store.ledgerFrom<LedgerEntry>(0) : readLedgerFile(LEDGER_PATH);
  return { entries, chain: verifyChain(entries) };
});

export class NotPublishedError extends Error {}

export const loadPolicy = cache(async (): Promise<PolicyEngine> => {
  if (!store) return PolicyEngine.load(CONFIG_PATH);
  const src = await store.getText(K.config);
  if (!src) throw new NotPublishedError("The agent has not published its policy yet. Run `pnpm worker` on the operator machine.");
  return PolicyEngine.fromSource(src);
});

export async function currentPolicy() {
  const p = await loadPolicy();
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
