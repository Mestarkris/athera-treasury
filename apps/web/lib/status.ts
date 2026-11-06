import "server-only";
import { deriveState } from "@athera/agents";
import { FileKillSwitch, fmt, key, parseUnits } from "@athera/policy";
import { DEFAULT_MAINNET_RPCS, NearRpc } from "@athera/settlement";
import { readFileSync } from "node:fs";
import { HALT_PATH, LOCK_PATH, loadPolicy, readLedger } from "./ledger";
import { operatorEnabled } from "./operator";

export interface RunState {
  runId: string;
  since: string;
}

export function readRunLock(): RunState | null {
  try {
    const v = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as { pid: number; runId: string; since: string };
    try {
      process.kill(v.pid, 0);
    } catch {
      return null; // stale
    }
    return { runId: v.runId, since: v.since };
  } catch {
    return null;
  }
}

export function killSwitchState() {
  const s = new FileKillSwitch(HALT_PATH).state();
  return { engaged: s.engaged, reason: s.reason ?? null, since: s.since ?? null, configFlag: loadPolicy().config.kill_switch };
}

let balanceCache: { at: number; value: string | null } | undefined;
/** Treasury balance inside the verifier, read from public RPC, cached 30s. Null if RPC fails. */
async function treasuryBalance(): Promise<{ value: string | null; at: string }> {
  if (balanceCache && Date.now() - balanceCache.at < 30_000) return { value: balanceCache.value, at: new Date(balanceCache.at).toISOString() };
  const cfg = loadPolicy().config;
  const asset = cfg.approved.assets[0];
  let value: string | null = null;
  try {
    const rpc = new NearRpc(DEFAULT_MAINNET_RPCS);
    value = asset ? await rpc.view<string>(cfg.verifier, "mt_balance_of", { account_id: cfg.accounts.treasury, token_id: asset }) : null;
  } catch {
    value = null;
  }
  balanceCache = { at: Date.now(), value };
  return { value, at: new Date(balanceCache.at).toISOString() };
}

/** Everything the status strip and control room show. All from the ledger, config.yaml or RPC. */
export async function getStatus() {
  const policy = loadPolicy();
  const cfg = policy.config;
  const { entries, chain } = readLedger();
  const asset = cfg.approved.assets[0] ?? "";
  const meta = cfg.assets.find((a) => a.id === asset);
  const decimals = meta?.decimals ?? 24;
  const state = deriveState(entries, {}, false, new Date());
  const moved = state.movedToday[key(cfg.accounts.treasury, asset)] ?? 0n;
  const limits = cfg.limits.capital_movement[asset];
  const perDay = limits ? parseUnits(limits.per_day, decimals) : 0n;
  const perTx = limits ? parseUnits(limits.per_tx, decimals) : 0n;
  const balance = await treasuryBalance();
  return {
    network: cfg.network,
    verifier: cfg.verifier,
    treasury: cfg.accounts.treasury,
    policy: { version: policy.ref.version, hash: policy.ref.hash },
    killSwitch: killSwitchState(),
    run: readRunLock(),
    operator: operatorEnabled(),
    ledger: { entries: entries.length, chainOk: chain.ok, lastSeq: entries.at(-1)?.seq ?? -1 },
    today: {
      date: new Date().toISOString().slice(0, 10),
      asset,
      symbol: meta?.symbol ?? asset,
      moved: { value: moved.toString(), display: fmt(cfg, asset, moved) },
      perDay: { value: perDay.toString(), display: fmt(cfg, asset, perDay) },
      perTx: { value: perTx.toString(), display: fmt(cfg, asset, perTx) },
      // Billed AI cost recorded in today's ledger "cost" entries (micro-USD → dollars).
      inference: { usedUsd: (Number(state.inferenceTodayMicros) / 1e6).toFixed(4), limitUsd: cfg.limits.inference_spend_per_day_usd },
    },
    balance: { display: balance.value === null ? null : fmt(cfg, asset, BigInt(balance.value)), at: balance.at },
  };
}

export type Status = Awaited<ReturnType<typeof getStatus>>;
