// pnpm facts <account> — print what the analyst would see about an account. Read-only, no AI call.
import { NearRpc, DEFAULT_MAINNET_RPCS } from "@athera/settlement";
import { OneClickClient, gatherFactsV2 } from "@athera/agents";
const account = process.argv[2];
if (!account) throw new Error("usage: pnpm facts <account>");
const rpc = new NearRpc(process.env["NEAR_RPC_URL"] || DEFAULT_MAINNET_RPCS);
const facts = await gatherFactsV2(rpc, "intents.near", account, await new OneClickClient().tokens());
console.log(JSON.stringify(facts, null, 1));
