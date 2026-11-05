// Generates the two runtime keys straight into .env (mode 600). Prints PUBLIC keys only.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { Ed25519Key } from "@athera/settlement";
import { CONFIG_PATH, ROOT } from "./wire.ts";

const envPath = resolve(ROOT, ".env");
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "NEAR_RPC_URL=https://rpc.mainnet.fastnear.com\n";
const cfg = parse(readFileSync(CONFIG_PATH, "utf8")) as { accounts: { treasury: string; revenue: string } };

function ensure(name: string): string {
  const m = new RegExp(`^${name}=(.+)$`, "m").exec(env);
  if (m?.[1]) return Ed25519Key.fromSecret(m[1].trim()).publicKey;
  const { key, secret } = Ed25519Key.generate();
  env = env.replace(new RegExp(`^${name}=.*\\n?`, "m"), "");
  env += `${env.endsWith("\n") || env === "" ? "" : "\n"}${name}=${secret}\n`;
  return key.publicKey;
}

const treasuryPk = ensure("ATHERA_TREASURY_FC_KEY");
const revenuePk = ensure("ATHERA_REVENUE_INTENT_KEY");
writeFileSync(envPath, env, { mode: 0o600 });
chmodSync(envPath, 0o600);

console.log(`.env written (mode 600). Secrets were not printed.

  treasury  ${cfg.accounts.treasury}
            ${treasuryPk}
  revenue   ${cfg.accounts.revenue}
            ${revenuePk}

Next: follow docs/setup.md to authorize these PUBLIC keys from your own wallet/CLI.`);
