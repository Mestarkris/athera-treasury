// Read-only: prints the on-chain custody state for config.yaml's accounts.
import { NearRpc, DEFAULT_MAINNET_RPCS } from "@athera/settlement";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { CONFIG_PATH } from "./wire.ts";

const cfg = parse(readFileSync(CONFIG_PATH, "utf8")) as { accounts: { treasury: string; revenue: string }; verifier: string };
const rpc = new NearRpc(process.env["NEAR_RPC_URL"] || DEFAULT_MAINNET_RPCS);
for (const [role, id] of Object.entries(cfg.accounts)) {
  const keys = await rpc
    .call<{ keys: { public_key: string; access_key: { permission: unknown } }[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: id })
    .then((r) => r.keys)
    .catch((e: unknown) => `error: ${String(e)}`);
  const inVerifier = await rpc.view<string[]>(cfg.verifier, "public_keys_of", { account_id: id });
  const bal = await rpc.view<string>(cfg.verifier, "mt_balance_of", { account_id: id, token_id: "nep141:wrap.near" });
  console.log(`${role} ${id}`);
  if (typeof keys === "string") console.log(`  account keys: ${keys}`);
  else for (const k of keys) console.log(`  account key  ${k.public_key}  ${JSON.stringify(k.access_key.permission)}`);
  console.log(`  verifier keys ${JSON.stringify(inVerifier)}`);
  console.log(`  wNEAR in verifier ${Number(BigInt(bal) / 10n ** 18n) / 1e6}`);
}
