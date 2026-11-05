// Read-only format probe against mainnet intents.near. Signs a transfer intent with a
// throwaway in-memory key for a non-custodial account and calls simulate_intents (a view).
// Expected: rejection at signature/key level, proving our nonce, payload and signature
// encodings parse. Nothing is submitted; no funds are involved.
import { base58 } from "@scure/base";
import { Ed25519Key, NearRpc, DEFAULT_MAINNET_RPCS, nep413Prehash, toSignedJson, versionedNonce } from "@athera/settlement";

const rpc = new NearRpc(process.env["NEAR_RPC_URL"] || DEFAULT_MAINNET_RPCS);
const salt = await rpc.view<string>("intents.near", "current_salt", {});
const { key } = Ed25519Key.generate();
const deadline = new Date(Date.now() + 60_000);
const message = JSON.stringify({
  signer_id: "athera-format-probe.near",
  deadline: deadline.toISOString(),
  intents: [{ intent: "transfer", receiver_id: "athera-format-probe-2.near", tokens: { "nep141:wrap.near": "1" }, memo: "athera:probe" }],
});
const payload = { message, nonce: versionedNonce(salt, deadline), recipient: "intents.near" };
const digest = nep413Prehash(payload);
const signed = toSignedJson(payload, key.publicKey, key.sign(digest));
console.log(`salt ${salt} · intent_hash ${base58.encode(digest)}`);
try {
  const r = await rpc.view("intents.near", "simulate_intents", { signed: [signed] });
  console.log("simulate_intents accepted (unexpected for an unregistered key):", JSON.stringify(r));
} catch (e) {
  console.log("simulate_intents rejected:", e instanceof Error ? e.message : String(e));
}
