import { describe, expect, it } from "vitest";
import { MemoryLedger, verifyChain } from "@athera/ledger";
import { MemoryKillSwitch, PolicyEngine } from "@athera/policy";
import { FIXTURE_YAML } from "../../policy/test/fixtures.ts";
import { NearAiClient, meteredChat, parseJsonReply, type FetchLike } from "../src/index.ts";

const MODEL = "z-ai/glm-5.3-flash";

/** Fake NEAR AI Cloud: lists one priced model and answers chat with fixed usage. */
function fakeCloud(usage = { prompt_tokens: 1000, completion_tokens: 2000 }) {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ url, auth, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/models")) return Response.json({ data: [{ id: MODEL, pricing: { input: 0.08, output: 0.5 } }] });
    return Response.json({ model: MODEL, choices: [{ message: { content: '```json\n{"ok":true}\n```' } }], usage });
  };
  return { fetch, calls };
}

function setup(usage?: { prompt_tokens: number; completion_tokens: number }) {
  const cloud = fakeCloud(usage);
  const ai = new NearAiClient("sk-test", { baseUrl: "https://ai.test/v1", fetch: cloud.fetch });
  const d = { policy: PolicyEngine.fromSource(FIXTURE_YAML), ledger: new MemoryLedger(), killSwitch: new MemoryKillSwitch(), ai };
  return { d, cloud };
}

const req = (over: Record<string, unknown> = {}) => ({
  runId: "r1",
  proposalId: "r1-ai",
  agent: "analyst" as const,
  purpose: "write a report",
  model: MODEL,
  messages: [{ role: "user" as const, content: "hello" }],
  maxTokens: 4000,
  ...over,
});

describe("NEAR AI client", () => {
  it("bills tokens × listed price, rounded up to the micro-dollar", async () => {
    const { d } = setup();
    const r = await d.ai.chat({ model: MODEL, messages: [{ role: "user", content: "x" }], maxTokens: 10 });
    // 1000 × 0.08 + 2000 × 0.50 = 80 + 1000 micro-USD
    expect(r.costMicros).toBe(1080n);
    expect(parseJsonReply<{ ok: boolean }>(r.content)).toEqual({ ok: true });
  });
  it("projects the worst case from the full output budget", async () => {
    const { d } = setup();
    const p = await d.ai.projectCostMicros(MODEL, [{ role: "user", content: "hello" }], 4000);
    expect(p).toBeGreaterThanOrEqual(2000n); // 4000 × 0.50
  });
  it("refuses to call without a key", async () => {
    const ai = new NearAiClient(undefined, { fetch: fakeCloud().fetch });
    await expect(ai.chat({ model: MODEL, messages: [], maxTokens: 1 })).rejects.toThrow(/NEARAI_API_KEY/);
  });
});

describe("metered AI calls", () => {
  it("checks policy before the call and records the billed cost after", async () => {
    const { d, cloud } = setup();
    const out = await meteredChat(d, req());
    expect(out.kind).toBe("ok");
    const types = d.ledger.all().map((e) => `${e.type}:${e.result}`);
    expect(types).toEqual(["policy_check:pass", "cost:confirmed"]);
    const cost = d.ledger.all()[1]!;
    expect((cost.payload as { usd_micros: string }).usd_micros).toBe("1080");
    expect(cloud.calls.filter((c) => c.url.endsWith("/chat/completions"))).toHaveLength(1);
    expect(cloud.calls.find((c) => c.url.endsWith("/chat/completions"))?.auth).toBe("Bearer sk-test");
    expect(verifyChain(d.ledger.all())).toEqual({ ok: true });
  });
  it("never calls a model the policy blocks", async () => {
    const { d, cloud } = setup();
    const out = await meteredChat(d, req({ maxTokens: 100_000 })); // worst case $0.05 > $0.02 cap
    expect(out.kind).toBe("blocked");
    expect(cloud.calls.some((c) => c.url.endsWith("/chat/completions"))).toBe(false);
    expect(d.ledger.all().map((e) => e.type)).toEqual(["policy_check"]);
  });
  it("counts recorded costs toward the daily budget", async () => {
    // each call bills $0.50 actual; the $1.00/day budget allows two, then blocks.
    const { d } = setup({ prompt_tokens: 0, completion_tokens: 1_000_000 });
    expect((await meteredChat(d, req({ maxTokens: 1000 }))).kind).toBe("ok");
    expect((await meteredChat(d, req({ maxTokens: 1000 }))).kind).toBe("ok");
    expect((await meteredChat(d, req({ maxTokens: 1000 }))).kind).toBe("blocked");
  });
  it("stops at the kill switch before any check or call", async () => {
    const { d, cloud } = setup();
    d.killSwitch.engage("operator");
    await expect(meteredChat(d, req())).rejects.toThrow();
    expect(cloud.calls).toHaveLength(0);
  });
});
