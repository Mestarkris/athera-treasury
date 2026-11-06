// Builds the real runtime from config.yaml + .env. The only place secrets are read.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FileReportStore, NearAiClient, OneClickClient, Orchestrator } from "@athera/agents";
import { FileLedger } from "@athera/ledger";
import { FileKillSwitch, PolicyEngine, key } from "@athera/policy";
import {
  CustodyError,
  Ed25519Key,
  KeyIntentSigner,
  NearChain,
  NearRpc, DEFAULT_MAINNET_RPCS,
  Settlement,
  assertIntentKeyRegistered,
  assertScopedSubmitKey,
  type IntentSigner,
} from "@athera/settlement";

export const ROOT = resolve(import.meta.dirname, "../..");
export const CONFIG_PATH = resolve(ROOT, "config.yaml");
export const LEDGER_PATH = resolve(ROOT, process.env["ATHERA_LEDGER_PATH"] ?? "data/ledger.jsonl");
export const HALT_PATH = resolve(ROOT, "data/HALT");
export const LOCK_PATH = resolve(ROOT, "data/RUN.lock");
export const REPORTS_DIR = resolve(ROOT, "data/reports");
/**
 * Report writer. GLM-5.3-flash reasons before answering and can spend the whole output budget on
 * hidden reasoning (seen on mainnet, run r261106002713ca7b), so reports use Claude Haiku, which
 * answers with the JSON directly. Both are approved in config.yaml; override with ATHERA_REPORT_MODEL.
 */
export const REPORT_MODEL = "anthropic/claude-haiku-5-5";

export function loadEnv(): void {
  const p = resolve(ROOT, ".env");
  if (existsSync(p)) process.loadEnvFile(p);
}

function secret(name: string): Ed25519Key {
  const v = process.env[name];
  if (!v) throw new CustodyError(`${name} is not set. Run \`pnpm keygen\` and follow docs/setup.md.`);
  return Ed25519Key.fromSecret(v);
}

/** Counts signatures so demos can prove "the signer was never called". */
export class CountingSigner implements IntentSigner {
  calls = 0;
  constructor(private readonly inner: IntentSigner) {}
  get accountId() {
    return this.inner.accountId;
  }
  get publicKey() {
    return this.inner.publicKey;
  }
  sign(d: Uint8Array) {
    this.calls++;
    return this.inner.sign(d);
  }
}

export function wire() {
  loadEnv();
  const policy = PolicyEngine.load(CONFIG_PATH);
  const cfg = policy.config;
  const rpc = new NearRpc(process.env["NEAR_RPC_URL"] || DEFAULT_MAINNET_RPCS);
  const chain = new NearChain(rpc);
  const treasuryKey = secret("ATHERA_TREASURY_FC_KEY");
  const revenueKey = secret("ATHERA_REVENUE_INTENT_KEY");
  const signers = [
    new CountingSigner(new KeyIntentSigner(cfg.accounts.treasury, treasuryKey)),
    new CountingSigner(new KeyIntentSigner(cfg.accounts.revenue, revenueKey)),
  ];
  const killSwitch = new FileKillSwitch(HALT_PATH);
  const ledger = new FileLedger(LEDGER_PATH);
  const settlement = new Settlement({ chain, policy, killSwitch, intentSigners: signers, submitter: { accountId: cfg.accounts.treasury, key: treasuryKey } });

  const readBalances = async () => {
    const out: Record<string, bigint> = {};
    for (const account of [cfg.accounts.treasury, cfg.accounts.revenue]) {
      for (const asset of cfg.approved.assets) {
        out[key(account, asset)] = BigInt(await rpc.view<string>(cfg.verifier, "mt_balance_of", { account_id: account, token_id: asset }));
      }
    }
    return out;
  };

  // Sale loop services. The NEAR AI key is read here only; it never reaches logs or the ledger.
  const ai = new NearAiClient(process.env["NEARAI_API_KEY"] || undefined);
  const jwt = process.env["ONECLICK_JWT"];
  const oneclick = new OneClickClient(jwt ? { jwt } : {});
  const reports = new FileReportStore(REPORTS_DIR);
  const orchestrator = new Orchestrator({ policy, settlement, ledger, killSwitch, readBalances, sales: { oneclick, ai, rpc, reports, model: process.env["ATHERA_REPORT_MODEL"] || REPORT_MODEL } });

  /** Custody preflight: refuses to run with a full-access or mis-scoped key. */
  const preflight = async () => {
    const scope = await assertScopedSubmitKey(rpc, cfg.accounts.treasury, treasuryKey.publicKey, cfg.verifier);
    await assertIntentKeyRegistered(rpc, cfg.verifier, cfg.accounts.treasury, treasuryKey.publicKey);
    await assertIntentKeyRegistered(rpc, cfg.verifier, cfg.accounts.revenue, revenueKey.publicKey);
    // The revenue intent key must not be an access key on the NEAR account (least privilege).
    const onAccount = await rpc.accessKey(cfg.accounts.revenue, revenueKey.publicKey).then(
      (v) => v.permission,
      () => null,
    );
    if (onAccount === "FullAccess") throw new CustodyError("revenue intent key is a FULL-ACCESS key on the revenue account; refusing");
    return {
      treasury: { account: cfg.accounts.treasury, publicKey: treasuryKey.publicKey, scope: `FunctionCall → ${cfg.verifier}.execute_intents, allowance ${scope.allowance ?? "unlimited"}` },
      revenue: { account: cfg.accounts.revenue, publicKey: revenueKey.publicKey, scope: onAccount ? "intents.near signer + function-call key" : "intents.near signer only (no on-account key)" },
    };
  };

  return { policy, rpc, chain, ledger, killSwitch, settlement, orchestrator, signers, readBalances, preflight, ai, oneclick, reports };
}
