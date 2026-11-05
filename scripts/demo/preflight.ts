// Read-only: checks custody scope and balances. Signs nothing, sends nothing.
import { fmt } from "@athera/policy";
import { wire } from "./wire.ts";

const w = wire();
console.log(`policy v${w.policy.ref.version} · ${w.policy.ref.hash.slice(0, 6)}  network ${w.policy.config.network}  verifier ${w.policy.config.verifier}`);
const custody = await w.preflight();
console.log("custody ok");
for (const [role, c] of Object.entries(custody)) console.log(`  ${role.padEnd(9)}${c.account}\n           ${c.publicKey}\n           ${c.scope}`);
const bal = await w.readBalances();
console.log("balances in intents.near");
for (const [k, v] of Object.entries(bal)) {
  const [account, asset] = k.split("|") as [string, string];
  console.log(`  ${account.padEnd(40)} ${fmt(w.policy.config, asset, v).padStart(24)}`);
}
console.log(`halt flag: ${w.killSwitch.state().engaged ? "ENGAGED" : "off"}`);
