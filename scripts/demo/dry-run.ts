// Read-only: signs a policy-checked principal intent and runs simulate_intents (a view call).
// Nothing is broadcast; the intent's nonce is never committed and its deadline lapses.
import { parseUnits } from "@athera/policy";
import { deriveState, TreasuryAgent } from "@athera/agents";
import { nep413Prehash, toSignedJson, versionedNonce, Ed25519Key } from "@athera/settlement";
import { wire } from "./wire.ts";

const w = wire();
const cfg = w.policy.config;
const asset = cfg.approved.assets[0]!;
const vendor = cfg.counterparties.find((c) => c.role === "vendor")!.account;
const proposal = new TreasuryAgent(cfg).propose("dryrun-1", { to: vendor, asset, amount: parseUnits("0.01", 24).toString(), reason: "dry run" });
const check = w.policy.validate(proposal, deriveState(w.ledger.all(), await w.readBalances(), false));
console.log(check.summary);
if (check.result !== "pass") process.exit(1);

const salt = await w.rpc.view<string>(cfg.verifier, "current_salt", {});
const deadline = new Date(Date.now() + 60_000);
const message = JSON.stringify({ signer_id: proposal.from, deadline: deadline.toISOString(), intents: proposal.legs.map((l) => ({ intent: "transfer", receiver_id: l.to, tokens: { [l.asset]: l.amount }, memo: "athera:dry-run" })) });
const payload = { message, nonce: versionedNonce(salt, deadline), recipient: cfg.verifier };
const key = Ed25519Key.fromSecret(process.env["ATHERA_TREASURY_FC_KEY"]!);
const signed = toSignedJson(payload, key.publicKey, key.sign(nep413Prehash(payload)));
const out = await w.rpc.view<unknown>(cfg.verifier, "simulate_intents", { signed: [signed] });
console.log("simulate_intents:", JSON.stringify(out).slice(0, 700));
