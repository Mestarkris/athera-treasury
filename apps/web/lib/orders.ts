import "server-only";
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { FileOrderStore, OneClickClient, deriveState, newRunId, type Order, type OneClickToken, type StatusResult } from "@athera/agents";
import { DEFAULT_MAINNET_RPCS, NearRpc } from "@athera/settlement";
import { ROOT, loadPolicy, readLedger } from "./ledger";

export const ORDERS_DIR = resolve(ROOT, "data/orders");
export const orders = new FileOrderStore(ORDERS_DIR);
export const oneclick = new OneClickClient();

/** The web server holds no keys; it only reads chain state and asks 1Click for quotes. */
const rpc = new NearRpc(DEFAULT_MAINNET_RPCS);
export const accountExists = (id: string) =>
  rpc.call("query", { request_type: "view_account", finality: "final", account_id: id }).then(
    () => true,
    () => false,
  );

export const orderState = () => deriveState(readLedger().entries, {}, false, new Date());
export const orderPolicy = () => loadPolicy();

let tokenCache: { at: number; value: OneClickToken[] } | undefined;
/** 1Click's routable tokens with a price, cached for 10 minutes. */
export async function payTokens(): Promise<OneClickToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < 600_000) return tokenCache.value;
  const value = (await new OneClickClient().tokens()).filter((t) => t.price > 0).sort((a, b) => a.blockchain.localeCompare(b.blockchain) || a.symbol.localeCompare(b.symbol));
  tokenCache = { at: Date.now(), value };
  return value;
}

const statusCache = new Map<string, { at: number; value: StatusResult }>();
/** Live 1Click status for an order's deposit address, cached 4s so polling clients share calls. */
export async function liveStatus(o: Order): Promise<StatusResult | null> {
  const hit = statusCache.get(o.deposit_address);
  if (hit && Date.now() - hit.at < 4000) return hit.value;
  try {
    const value = await oneclick.status(o.deposit_address);
    statusCache.set(o.deposit_address, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

/** Public view of an order: the refund address is shown only partly. */
export function publicOrder(o: Order) {
  const { refund_to, quote_signature: _sig, ...rest } = o;
  return { ...rest, refund_to: refund_to.length > 12 ? `${refund_to.slice(0, 6)}…${refund_to.slice(-4)}` : refund_to };
}

/**
 * Start scripts/demo/run.ts as a separate process (it reads the keys, not this server). Same
 * pattern as /api/runs; the caller checks the kill switch and the run lock first.
 */
export function spawnRun(args: string[]): string {
  const runId = newRunId();
  const logDir = resolve(ROOT, "data/runs");
  mkdirSync(logDir, { recursive: true });
  const out = openSync(resolve(logDir, `${runId}.log`), "a");
  const child = spawn(process.execPath, ["--import", "tsx", resolve(ROOT, "scripts/demo/run.ts"), ...args, `--run-id=${runId}`], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, NODE_ENV: "production" },
  });
  child.unref();
  return runId;
}

const hits = new Map<string, number[]>();
/** Small in-memory limiter for order creation: `max` per `windowMs` per client. */
export function rateLimited(req: Request, max = 10, windowMs = 3_600_000): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}
