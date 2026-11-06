import { describe, expect, it, vi } from "vitest";
import { MemoryLedger, verifyChain } from "@athera/ledger";
import { MemoryKillSwitch, PolicyEngine, parseUnits } from "@athera/policy";
import { Ed25519Key, Settlement, type IntentSigner } from "@athera/settlement";
import { FIXTURE_YAML, W } from "../../policy/test/fixtures.ts";
import { FakeChain } from "../../settlement/test/fake-chain.ts";
import { MemoryReportStore, NearAiClient, OneClickClient, Orchestrator, pendingAccounting, type ChainReader, type FetchLike } from "../src/index.ts";

const USDC = "nep141:usdc.near";
const DEPOSIT = "d".repeat(64);
const MODEL = "z-ai/glm-5.3-flash";

const SALE_YAML = FIXTURE_YAML.replace('assets: ["nep141:wrap.near"]', `assets: ["nep141:wrap.near", "${USDC}"]`)
  .replace('"nep141:wrap.near": { per_tx: "0.05", per_day: "0.20" }', `"nep141:wrap.near": { per_tx: "0.05", per_day: "0.20" }\n    "${USDC}": { per_tx: "1.00", per_day: "5.00" }`)
  .replace("treasury: [transfer]", "treasury: [transfer, service_purchase]")
  .replace('settle_asset: "nep141:wrap.near"', `settle_asset: "${USDC}"`);

interface FakeOpts {
  status?: string;
  recipient?: string;
  amountIn?: string;
  aiReply?: string;
}

function fakeServices(o: FakeOpts = {}) {
  const quoteBodies: Record<string, unknown>[] = [];
  let chatCalls = 0;
  const oneclickFetch: FetchLike = async (url, init) => {
    if (url.endsWith("/tokens")) return Response.json([{ assetId: W, symbol: "wNEAR", decimals: 24, blockchain: "near", price: 3.6 }, { assetId: USDC, symbol: "USDC", decimals: 6, blockchain: "near", price: 1 }]);
    if (url.endsWith("/quote")) {
      const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
      quoteBodies.push(b);
      return Response.json({
        signature: "ed25519:quote",
        quote: { depositAddress: DEPOSIT, amountIn: o.amountIn ?? parseUnits("0.0139", 24).toString(), amountInUsd: "0.0505", amountOut: b["amount"], amountOutUsd: "0.05", deadline: new Date(Date.now() + 600_000).toISOString(), timeEstimate: 12 },
      });
    }
    if (url.includes("/status")) {
      return Response.json({ status: o.status ?? "SUCCESS", swapDetails: { intentHashes: ["IH1"], nearTxHashes: ["TX1"], amountOut: "50000", refundedAmount: "0" } });
    }
    return new Response("not found", { status: 404 });
  };
  const aiFetch: FetchLike = async (url) => {
    if (url.endsWith("/models")) return Response.json({ data: [{ id: MODEL, pricing: { input: 0.08, output: 0.5 } }] });
    chatCalls++;
    const content =
      o.aiReply ??
      JSON.stringify({ headline: "Small, liquid treasury held mostly in wNEAR", summary: "The account holds about $2.97.", observations: ["a", "b", "c"], risks: ["r1", "r2"], recommendations: ["k1", "k2", "k3"] });
    return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 600, completion_tokens: 300 } });
  };
  const rpc: ChainReader = {
    async call<T>() {
      return { amount: parseUnits("0.36", 24).toString(), storage_usage: 320, code_hash: "11111111111111111111111111111111", block_height: 1 } as T;
    },
    async view<T>(_c: string, method: string) {
      return (method === "mt_tokens_for_owner" ? [{ token_id: W }] : [parseUnits("0.4495", 24).toString()]) as T;
    },
  };
  return { oneclickFetch, aiFetch, rpc, quoteBodies, chatCalls: () => chatCalls };
}

function setup(o: FakeOpts = {}, yaml = SALE_YAML) {
  const policy = PolicyEngine.fromSource(yaml);
  const chain = new FakeChain();
  const killSwitch = new MemoryKillSwitch();
  const ledger = new MemoryLedger();
  const tKey = Ed25519Key.generate().key;
  const rKey = Ed25519Key.generate().key;
  const treasurySign = vi.fn((d: Uint8Array) => tKey.sign(d));
  const revenueSign = vi.fn((d: Uint8Array) => rKey.sign(d));
  const signers: IntentSigner[] = [
    { accountId: "dao-treasury.near", publicKey: tKey.publicKey, sign: treasurySign },
    { accountId: "athera-revenue.near", publicKey: rKey.publicKey, sign: revenueSign },
  ];
  const settlement = new Settlement({ chain, policy, killSwitch, intentSigners: signers, submitter: { accountId: "dao-treasury.near", key: tKey } });
  const readBalances = async () => ({
    [`dao-treasury.near|${W}`]: parseUnits("0.5", 24),
    [`athera-revenue.near|${W}`]: 0n,
    [`athera-revenue.near|${USDC}`]: 50_000n,
  });
  const f = fakeServices(o);
  const reports = new MemoryReportStore();
  const sales = {
    oneclick: new OneClickClient({ baseUrl: "https://1click.test/v0", fetch: f.oneclickFetch }),
    ai: new NearAiClient("sk-test", { baseUrl: "https://ai.test/v1", fetch: f.aiFetch }),
    rpc: f.rpc,
    reports,
    poll: { sleep: async () => {} },
  };
  const orch = new Orchestrator({ policy, settlement, ledger, killSwitch, readBalances, sales });
  return { orch, ledger, reports, killSwitch, f, treasurySign, revenueSign };
}

const order = { customer: "dao-treasury.near", subject: "dao-treasury.near" };

describe("sale loop", () => {
  it("offers, quotes, pays, settles, splits the USDC and delivers an AI report", async () => {
    const { orch, ledger, reports, f, treasurySign, revenueSign } = setup();
    const out = await orch.runSale(order);
    expect(out.status).toBe("completed");
    const types = ledger.all().map((e) => `${e.agent}:${e.type}:${e.result}`);
    const move = (a: string) => [`${a}:proposal:info`, "policy:policy_check:pass", "settlement:intent_created:pending", "settlement:intent_submitted:pending", "settlement:settlement:confirmed"];
    expect(types).toEqual([
      "sales:proposal:info",
      "policy:policy_check:pass",
      "sales:quote:info",
      ...move("treasury"),
      "sales:sale:confirmed",
      ...move("accounting"),
      "accounting:payout:confirmed",
      "accounting:payout:confirmed",
      "policy:policy_check:pass",
      "analyst:cost:confirmed",
      "analyst:report:confirmed",
    ]);
    expect(treasurySign).toHaveBeenCalledTimes(1);
    expect(revenueSign).toHaveBeenCalledTimes(1);
    expect(f.chatCalls()).toBe(1);
    // The quote asked 1Click for exactly $0.05 of USDC to the revenue account inside the verifier.
    expect(f.quoteBodies[0]).toMatchObject({ swapType: "EXACT_OUTPUT", amount: "50000", recipient: "athera-revenue.near", recipientType: "INTENTS", depositType: "INTENTS" });
    const payouts = ledger.all().filter((e) => e.type === "payout").map((e) => e.amount?.value);
    expect(payouts).toEqual(["35000", "15000"]);
    const report = reports.get(out.status === "completed" ? out.reportId! : "")!;
    expect(report.analysis.headline).toMatch(/wNEAR/);
    expect(report.facts.total_usd).toBeCloseTo(0.36 * 3.6 + 0.4495 * 3.6, 1);
    expect(report.payment?.near_tx_hashes).toEqual(["TX1"]);
    expect(verifyChain(ledger.all())).toEqual({ ok: true });
    expect(pendingAccounting(ledger.all()).fees).toEqual([]); // nothing left to split
  });

  it("blocks an offer priced outside the bounds before anything is quoted or signed", async () => {
    const { orch, ledger, f, treasurySign } = setup();
    const out = await orch.runSale({ ...order, price_usd: "5.00" });
    expect(out.status).toBe("blocked");
    expect(f.quoteBodies).toHaveLength(0);
    expect(treasurySign).not.toHaveBeenCalled();
    expect(ledger.all().at(-1)?.result).toBe("block");
  });

  it("refuses to pay a quote larger than the treasury's per-tx limit", async () => {
    const { orch, treasurySign } = setup({ amountIn: parseUnits("0.06", 24).toString() });
    const out = await orch.runSale(order);
    expect(out.status).toBe("blocked");
    if (out.status === "blocked") expect(out.check.rules.find((r) => r.rule === "per_tx_limit")?.status).toBe("block");
    expect(treasurySign).not.toHaveBeenCalled();
  });

  it("records a refunded swap as no sale and pays no split", async () => {
    const { orch, ledger, revenueSign, f } = setup({ status: "REFUNDED" });
    const out = await orch.runSale(order);
    expect(out.status).toBe("failed");
    expect(ledger.all().some((e) => e.type === "sale" && e.result === "failed")).toBe(true);
    expect(revenueSign).not.toHaveBeenCalled();
    expect(f.chatCalls()).toBe(0);
  });

  it("stops at the kill switch before the payment is signed", async () => {
    const { orch, killSwitch, treasurySign } = setup();
    killSwitch.engage("operator test");
    const out = await orch.runSale(order);
    expect(out.status).toBe("halted");
    expect(treasurySign).not.toHaveBeenCalled();
  });

  it("does not crash on a malformed AI reply; the sale and split still stand", async () => {
    const { orch, ledger } = setup({ aiReply: "sorry, no JSON" });
    const out = await orch.runSale(order);
    expect(out.status).toBe("failed");
    expect(ledger.all().filter((e) => e.type === "payout")).toHaveLength(2);
    expect(ledger.all().some((e) => e.type === "cost")).toBe(true); // the call was still paid for and recorded
  });

  it("writes the missing report for a paid sale without paying again", async () => {
    const { orch, ledger, reports, treasurySign, revenueSign } = setup({ aiReply: "sorry, no JSON" });
    expect((await orch.runSale(order)).status).toBe("failed");
    const sale = ledger.all().find((e) => e.type === "sale")!;
    // Swap the AI reply for a good one: same deps, new orchestrator over the same ledger.
    const good = setup();
    const orch2 = new Orchestrator({ ...(orch as unknown as { d: ConstructorParameters<typeof Orchestrator>[0] }).d, sales: { ...(good.orch as unknown as { d: ConstructorParameters<typeof Orchestrator>[0] }).d.sales!, reports } });
    const signsBefore = treasurySign.mock.calls.length + revenueSign.mock.calls.length;
    const out = await orch2.retryReport(sale.id);
    expect(out.status).toBe("completed");
    expect(treasurySign.mock.calls.length + revenueSign.mock.calls.length).toBe(signsBefore);
    const rep = ledger.all().find((e) => e.type === "report")!;
    expect(rep.upstream).toContain(sale.id);
    expect(reports.list()).toHaveLength(1);
    expect((await orch2.retryReport(sale.id)).status).toBe("failed"); // never twice
  });
});
