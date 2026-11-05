import "server-only";
import { DEFAULT_MAINNET_RPCS, NearRpc } from "@athera/settlement";
import { loadPolicy } from "./ledger";

export interface AccountKeys {
  account: string;
  role: "treasury" | "revenue";
  onAccount: { publicKey: string; permission: string }[] | null;
  inVerifier: string[] | null;
}

let cache: { at: number; value: AccountKeys[] } | undefined;

function describe(p: unknown): string {
  if (p === "FullAccess") return "Full access";
  const fc = (p as { FunctionCall?: { receiver_id: string; method_names: string[]; allowance: string | null } }).FunctionCall;
  if (!fc) return JSON.stringify(p);
  const allowance = fc.allowance ? `${(Number(BigInt(fc.allowance) / 10n ** 20n) / 10_000).toString()} NEAR gas allowance` : "unlimited gas allowance";
  return `Function call: ${fc.receiver_id} → ${fc.method_names.join(", ") || "any method"} (${allowance})`;
}

/** Live from public RPC, cached 60s: what keys can act for each account, on-chain and in the verifier. */
export async function liveKeys(): Promise<{ at: string; accounts: AccountKeys[] }> {
  if (cache && Date.now() - cache.at < 60_000) return { at: new Date(cache.at).toISOString(), accounts: cache.value };
  const cfg = loadPolicy().config;
  const rpc = new NearRpc(DEFAULT_MAINNET_RPCS);
  const accounts: AccountKeys[] = [];
  for (const [role, account] of [
    ["treasury", cfg.accounts.treasury],
    ["revenue", cfg.accounts.revenue],
  ] as const) {
    const onAccount = await rpc
      .call<{ keys: { public_key: string; access_key: { permission: unknown } }[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: account })
      .then((r) => r.keys.map((k) => ({ publicKey: k.public_key, permission: describe(k.access_key.permission) })))
      .catch(() => null);
    const inVerifier = await rpc.view<string[]>(cfg.verifier, "public_keys_of", { account_id: account }).catch(() => null);
    accounts.push({ account, role, onAccount, inVerifier });
  }
  cache = { at: Date.now(), value: accounts };
  return { at: new Date(cache.at).toISOString(), accounts };
}
