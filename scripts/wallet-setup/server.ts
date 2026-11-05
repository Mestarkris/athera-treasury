// One-time setup helper for NEAR mainnet custody (docs/setup.md, docs/decisions.md D4, D9).
//
// Serves a local page where the account owner approves setup transactions in their own
// wallet. This process never sees the owner's key. It holds exactly one short-lived
// key in memory (never on disk): the ephemeral full-access key added to the new revenue
// sub-account, used once to call intents.near.add_public_key(REVENUE_PK) and then deleted
// on-chain in the very next transaction.
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createServer as createVite } from "vite";
import { PolicyEngine } from "@athera/policy";
import { hex } from "@scure/base";
import { Ed25519Key, NearRpc, DEFAULT_MAINNET_RPCS, signTx, type FinalTxResult } from "@athera/settlement";

const ROOT = resolve(import.meta.dirname, "../..");
process.loadEnvFile(resolve(ROOT, ".env"));
const cfg = PolicyEngine.load(resolve(ROOT, "config.yaml")).config;
const rpc = new NearRpc(process.env["NEAR_RPC_URL"] || DEFAULT_MAINNET_RPCS);
const W = "nep141:wrap.near";

const pub = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing; run pnpm keygen`);
  return Ed25519Key.fromSecret(v).publicKey; // only the public half leaves this function
};
const TREASURY_PK = pub("ATHERA_TREASURY_FC_KEY");
const REVENUE_PK = pub("ATHERA_REVENUE_INTENT_KEY");
const ephemeral = Ed25519Key.generate().key; // memory only

const treasury = cfg.accounts.treasury;
// Meteor refuses to add full-access keys (even to a new sub-account), so the revenue account
// is the implicit account of the one-time setup key: the owner only sends it a plain transfer.
// See docs/decisions.md D10.
const revenue = hex.encode(ephemeral.publicKeyRaw);

async function accountExists(id: string) {
  return rpc.call<{ amount: string }>("query", { request_type: "view_account", finality: "final", account_id: id }).then(
    (r) => ({ exists: true, amount: BigInt(r.amount) }),
    () => ({ exists: false, amount: 0n }),
  );
}
async function keys(id: string) {
  return rpc
    .call<{ keys: { public_key: string; access_key: { permission: unknown } }[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: id })
    .then((r) => r.keys)
    .catch(() => []);
}
const view = <T>(c: string, m: string, a: unknown) => rpc.view<T>(c, m, a);

let cached: { at: number; value: Awaited<ReturnType<typeof statusUncached>> } | undefined;
async function status(fresh = false) {
  if (!fresh && cached && Date.now() - cached.at < 6000) return cached.value;
  const value = await statusUncached();
  cached = { at: Date.now(), value };
  return value;
}

async function statusUncached() {
  // Sequential on purpose: public RPCs rate-limit parallel bursts.
  const tAcc = await accountExists(treasury);
  const tKeys = await keys(treasury);
  const tReg = await view<boolean>(cfg.verifier, "has_public_key", { account_id: treasury, public_key: TREASURY_PK });
  const wrapReg = await view<unknown>("wrap.near", "storage_balance_of", { account_id: treasury });
  const bal = await view<string>(cfg.verifier, "mt_balance_of", { account_id: treasury, token_id: W });
  const rAcc = await accountExists(revenue);
  const rKeys = await keys(revenue);
  const rReg = await view<boolean>(cfg.verifier, "has_public_key", { account_id: revenue, public_key: REVENUE_PK });
  const setupKeyInVerifier = await view<boolean>(cfg.verifier, "has_public_key", { account_id: revenue, public_key: ephemeral.publicKey });
  const owner = tKeys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key);
  const fc = tKeys.find((k) => k.public_key === TREASURY_PK)?.access_key.permission as
    | { FunctionCall?: { receiver_id: string; method_names: string[] } }
    | "FullAccess"
    | undefined;
  const fcOk = typeof fc === "object" && fc.FunctionCall?.receiver_id === cfg.verifier && fc.FunctionCall.method_names.join() === "execute_intents";
  return {
    treasury,
    revenue,
    treasuryPk: TREASURY_PK,
    revenuePk: REVENUE_PK,
    ephemeralPk: ephemeral.publicKey,
    ownerFullAccessKeys: owner,
    revenueBalance: rAcc.amount.toString(),
    nearBalance: tAcc.amount.toString(),
    wrapRegistered: wrapReg !== null,
    steps: {
      funded: tAcc.amount >= 600_000_000_000_000_000_000_000n || BigInt(bal) > 0n,
      fcKey: fcOk,
      fcKeyWrongScope: fc !== undefined && !fcOk,
      treasuryRegistered: tReg,
      deposited: BigInt(bal) > 0n,
      revenueAccount: rAcc.exists,
      ephemeralOnRevenue: rKeys.some((k) => k.public_key === ephemeral.publicKey),
      revenueRegistered: rReg,
      setupKeyInVerifier,
      ownerOnRevenue: rKeys.some((k) => owner.includes(k.public_key) && k.access_key.permission === "FullAccess"),
      revenueKeys: rKeys.map((k) => ({ key: k.public_key, fullAccess: k.access_key.permission === "FullAccess" })),
    },
    intentsBalance: bal,
  };
}

async function sendAsEphemeral(receiverId: string, actions: Parameters<typeof signTx>[0] extends infer T ? (T extends { actions: infer A } ? A : never) : never) {
  const k = await rpc.accessKey(revenue, ephemeral.publicKey);
  const tx = signTx({ signerId: revenue, publicKeyRaw: ephemeral.publicKeyRaw, nonce: BigInt(k.nonce) + 1n, receiverId, blockHash: k.block_hash, actions }, ephemeral);
  const res: FinalTxResult = await rpc.sendTx(tx.base64, "FINAL");
  if (typeof res.status === "object" && "Failure" in res.status) throw new Error(`tx ${tx.hash} failed: ${JSON.stringify(res.status.Failure)}`);
  return tx.hash;
}

/**
 * Final step, signed by the one-time setup key as the implicit revenue account:
 *   tx A → intents.near: add_public_key(REVENUE_PK), remove_public_key(setup key's implicit registration)
 *   tx B → revenue:      AddKey(owner's wallet key, FullAccess), DeleteKey(setup key)
 * Afterwards the account is controlled by the owner's wallet key, REVENUE_PK can only sign
 * intents inside the verifier, and the setup key is gone from both places.
 */
async function finishRevenue() {
  const s = await status(true);
  if (!s.steps.revenueAccount) throw new Error(`${revenue} has not been funded yet`);
  if (!s.steps.ephemeralOnRevenue) {
    if (s.steps.revenueRegistered && !s.steps.setupKeyInVerifier && s.steps.ownerOnRevenue) return { already: "done" };
    throw new Error("setup key is not on the revenue account (server restarted after funding?)");
  }
  const owner = s.ownerFullAccessKeys;
  if (owner.length !== 1 || !owner[0]) throw new Error(`expected exactly one full-access key on ${treasury}, found ${owner.length}`);
  const out: Record<string, string> = {};
  const verifierCalls: Parameters<typeof sendAsEphemeral>[1] = [];
  if (!s.steps.revenueRegistered) {
    verifierCalls.push({ type: "FunctionCall", methodName: "add_public_key", args: { public_key: REVENUE_PK }, gas: 10_000_000_000_000n, deposit: 1n });
  }
  if (s.steps.setupKeyInVerifier) {
    verifierCalls.push({ type: "FunctionCall", methodName: "remove_public_key", args: { public_key: ephemeral.publicKey }, gas: 10_000_000_000_000n, deposit: 1n });
  }
  if (verifierCalls.length) out["verifier_keys"] = await sendAsEphemeral(cfg.verifier, verifierCalls);
  out["hand_over"] = await sendAsEphemeral(revenue, [
    ...(s.steps.ownerOnRevenue ? [] : [{ type: "AddFullAccessKey" as const, publicKey: owner[0] }]),
    { type: "DeleteKey", publicKey: ephemeral.publicKey },
  ]);
  return out;
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
};

const vite = await createVite({ root: import.meta.dirname, server: { middlewareMode: true }, appType: "spa", logLevel: "warn" });
const port = Number(process.env["SETUP_PORT"] ?? 5174);
createHttp(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url && !req.url.startsWith("/api/") && !req.url.startsWith("/node_modules/") && !req.url.startsWith("/@")) {
    console.log(`[http ${new Date().toISOString()}] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
  }
  try {
    if (req.url === "/api/status") return json(res, 200, await status());
    if (req.url === "/api/client-log" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += String(chunk);
      console.log(`[page ${new Date().toISOString()}] ${body.slice(0, 4000)}`);
      return json(res, 200, { ok: true });
    }
    if (req.url === "/api/finish-revenue" && req.method === "POST") return json(res, 200, await finishRevenue());
  } catch (e) {
    return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
  vite.middlewares(req, res);
}).listen(port, "127.0.0.1", () => {
  console.log(`Athera wallet setup → http://localhost:${port}`);
  console.log(`  treasury ${treasury}  key ${TREASURY_PK}`);
  console.log(`  revenue  ${revenue} (implicit account of the setup key)  intent key ${REVENUE_PK}`);
  console.log(`  one-time setup key (memory only) ${ephemeral.publicKey}`);
});
