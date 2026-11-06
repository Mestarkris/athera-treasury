// pnpm worker              — keep the hosted site in step with this machine, and fulfil paid orders
// pnpm worker --once       — one tick, then exit (for cron)
// pnpm worker --no-fulfil  — publish only; never starts a run
// --interval=<seconds>     — time between ticks (default 30)
//
// The site on Vercel holds no keys. This worker is the bridge, every tick:
//   1. kill switch: a halt set on the site is copied here (and a local halt is shown there)
//   2. orders: new orders created on the site are copied into data/orders/
//   3. fulfil: open orders that 1Click reports as paid are fulfilled by `pnpm demo --mode=fulfil`,
//      a separate process that loads the keys and re-checks everything itself
//   4. publish: ledger entries, reports, order status, config.yaml and its git history
// The store only ever receives what the public site already shows.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FileOrderStore, FileReportStore, OneClickClient, newRunId, type Order } from "@athera/agents";
import { readLedgerFile, type LedgerEntry } from "@athera/ledger";
import { FileKillSwitch } from "@athera/policy";
import { AtheraStore, K, policyDirtyFromGit, policyHistoryFromGit, type AgentMeta } from "@athera/store";
import { readLock } from "./lock.ts";
import { CONFIG_PATH, HALT_PATH, LEDGER_PATH, LOCK_PATH, ORDERS_DIR, REPORTS_DIR, ROOT, loadEnv } from "./wire.ts";

loadEnv();
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const once = process.argv.includes("--once");
const fulfil = !process.argv.includes("--no-fulfil");
const intervalS = Math.max(10, Number(arg("interval") ?? 30));

const maybeStore = AtheraStore.fromEnv();
if (!maybeStore) {
  console.error("No hosted store configured. Add KV_REST_API_URL and KV_REST_API_TOKEN to .env (see docs/hosting.md).");
  process.exit(2);
}
const store: AtheraStore = maybeStore;
const orders = new FileOrderStore(ORDERS_DIR);
const reports = new FileReportStore(REPORTS_DIR);
const killSwitch = new FileKillSwitch(HALT_PATH);
const oneclick = new OneClickClient();
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

/** Open orders are only chased for a week; after that 1Click has refunded or the customer gave up. */
const OPEN_FOR_MS = 7 * 86_400_000;

async function syncHalt(): Promise<boolean> {
  const local = killSwitch.state();
  const remote = await store.halt();
  if (remote && !local.engaged) {
    killSwitch.engage(`${remote.reason} (from the site, ${remote.since})`);
    log(`kill switch ENGAGED from the site: ${remote.reason}`);
  } else if (local.engaged && !remote) {
    await store.engageHalt(local.reason ?? "operator halt", local.since);
  }
  return killSwitch.state().engaged;
}

async function pullOrders(): Promise<void> {
  const local = new Set(orders.list().map((o) => o.id));
  const missing = (await store.hkeys(K.orders)).filter((id) => !local.has(id));
  for (const id of missing) {
    const o = await store.hget<Order>(K.orders, id);
    if (o) {
      orders.save(o);
      log(`order ${id} received (${o.subject}, $${o.price_usd})`);
    }
  }
}

/** Run one fulfilment in its own process (it loads the keys); resolves with its exit code. */
function runFulfil(orderId: string): Promise<number> {
  const runId = newRunId();
  const logDir = resolve(ROOT, "data/runs");
  mkdirSync(logDir, { recursive: true });
  const out = openSync(resolve(logDir, `${runId}.log`), "a");
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", resolve(ROOT, "scripts/demo/run.ts"), "--mode=fulfil", `--order=${orderId}`, `--run-id=${runId}`], {
      cwd: ROOT,
      stdio: ["ignore", out, out],
      env: { ...process.env, NODE_ENV: "production" },
    });
    void publishMeta({ runId, since: new Date().toISOString() });
    child.on("exit", (code) => {
      closeSync(out);
      log(`order ${orderId}: run ${runId} exited ${code ?? "?"} (log data/runs/${runId}.log)`);
      done(code ?? 1);
    });
  });
}

async function fulfilPaid(halted: boolean): Promise<void> {
  if (!fulfil || halted || readLock(LOCK_PATH)) return;
  const open = orders.list().filter((o) => (o.status === "awaiting_payment" || o.status === "paid") && Date.now() - Date.parse(o.created_at) < OPEN_FOR_MS);
  for (const o of open) {
    const st = await oneclick.status(o.deposit_address).catch(() => null);
    if (st?.status !== "SUCCESS") continue;
    if (killSwitch.state().engaged) return;
    log(`order ${o.id}: paid, fulfilling`);
    await runFulfil(o.id);
    await publish(); // show the report as soon as it exists
  }
}

async function publishLedger(): Promise<void> {
  const local = readLedgerFile(LEDGER_PATH);
  const remoteLen = await store.ledgerLength();
  let from = remoteLen;
  // The ledger is append-only, so the store must be a prefix of it. If not, rewrite it whole.
  const lastRemote = remoteLen > 0 ? await store.redis.cmd<string | null>("LINDEX", K.ledger, remoteLen - 1) : null;
  const prefixOk = remoteLen <= local.length && (remoteLen === 0 || (lastRemote !== null && (JSON.parse(lastRemote) as LedgerEntry).hash === local[remoteLen - 1]?.hash));
  if (!prefixOk) {
    log(`store ledger (${remoteLen}) is not a prefix of the local one (${local.length}); republishing`);
    await store.redis.cmd("DEL", K.ledger);
    from = 0;
  }
  const add = local.slice(from);
  for (let i = 0; i < add.length; i += 100) await store.redis.cmd("RPUSH", K.ledger, ...add.slice(i, i + 100).map((e) => JSON.stringify(e)));
  if (add.length) log(`published ${add.length} ledger entr${add.length === 1 ? "y" : "ies"}`);
}

async function publishDocs(): Promise<void> {
  const haveReports = new Set(await store.hkeys(K.reports));
  for (const r of reports.list()) if (!haveReports.has(r.id)) await store.hset(K.reports, r.id, r);
  // Local order files are authoritative once copied here (status, report id).
  const remote = new Map((await store.hvalues<Order>(K.orders)).map((o) => [o.id, JSON.stringify(o)]));
  for (const o of orders.list()) if (remote.get(o.id) !== JSON.stringify(o)) await store.hset(K.orders, o.id, o);
  await store.redis.pipeline([
    ["SET", K.config, readFileSync(CONFIG_PATH, "utf8")],
    ["SET", K.policyHistory, JSON.stringify(policyHistoryFromGit(ROOT))],
  ]);
}

async function publishMeta(run: AgentMeta["run"]): Promise<void> {
  const meta: AgentMeta = {
    seen_at: new Date().toISOString(),
    ai_key: Boolean(process.env["NEARAI_API_KEY"]),
    policy_dirty: policyDirtyFromGit(ROOT),
    run,
    interval_s: intervalS,
  };
  await store.redis.cmd("SET", K.agent, JSON.stringify(meta));
}

async function publish(): Promise<void> {
  await publishLedger();
  await publishDocs();
  const l = readLock(LOCK_PATH);
  await publishMeta(l ? { runId: l.runId, since: l.since } : null);
}

async function tick(): Promise<void> {
  const halted = await syncHalt();
  await pullOrders();
  await publish();
  await fulfilPaid(halted);
}

log(`worker started · every ${intervalS}s · fulfil ${fulfil ? "on" : "off"} · store ${new URL(storeHost()).host}`);
function storeHost(): string {
  return process.env["KV_REST_API_URL"] ?? process.env["UPSTASH_REDIS_REST_URL"] ?? "";
}

let failures = 0;
for (;;) {
  try {
    await tick();
    failures = 0;
  } catch (e) {
    failures++;
    log(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
    if (once) process.exit(1);
  }
  if (once) break;
  await new Promise((r) => setTimeout(r, Math.min(intervalS * 1000 * 2 ** Math.min(failures, 3), 300_000)));
}
