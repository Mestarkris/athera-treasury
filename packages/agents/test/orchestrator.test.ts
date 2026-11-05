import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MemoryLedger, verifyChain } from "@athera/ledger";
import { MemoryKillSwitch, PolicyEngine, parseUnits } from "@athera/policy";
import { Ed25519Key, Settlement, type IntentSigner } from "@athera/settlement";
import { FIXTURE_YAML, W, near } from "../../policy/test/fixtures.ts";
import { FakeChain } from "../../settlement/test/fake-chain.ts";
import { Orchestrator } from "../src/index.ts";

function setup(yaml = FIXTURE_YAML) {
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
  });
  const orch = new Orchestrator({ policy, settlement, ledger, killSwitch, readBalances });
  const signCalls = () => treasurySign.mock.calls.length + revenueSign.mock.calls.length;
  return { orch, chain, killSwitch, ledger, signCalls, treasurySign, revenueSign };
}

const pay = (amount: string, to = "vendor.near") => ({ to, asset: W, amount: near(amount), reason: "pay vendor invoice" });

describe("full loop", () => {
  it("runs principal → fee → revenue split and logs every step", async () => {
    const { orch, ledger, treasurySign, revenueSign } = setup();
    const out = await orch.run(pay("0.01"));
    expect(out.status).toBe("completed");
    const types = ledger.all().map((e) => `${e.type}:${e.result}`);
    const leg = ["proposal:info", "policy_check:pass", "intent_created:pending", "intent_submitted:pending", "settlement:confirmed"];
    expect(types).toEqual([...leg, ...leg, "fee:confirmed", ...leg, "payout:confirmed", "payout:confirmed"]);
    expect(treasurySign).toHaveBeenCalledTimes(2); // principal + fee
    expect(revenueSign).toHaveBeenCalledTimes(1); // split
    expect(verifyChain(ledger.all())).toEqual({ ok: true });
    for (const e of ledger.all()) {
      expect(e.policy.hash).toMatch(/^[0-9a-f]{64}$/);
      if (e.type === "settlement") expect(e.refs?.explorer?.[0]).toMatch(/^https:\/\/nearblocks\.io\/txns\//);
    }
    const payouts = ledger.all().filter((e) => e.type === "payout");
    expect(payouts.reduce((s, e) => s + BigInt(e.amount?.value ?? "0"), 0n)).toBe(parseUnits("0.0001", 24));
  });
});

describe("an invalid action never reaches signing", () => {
  it("over the per-tx limit: blocked before intent creation; signer and network untouched", async () => {
    const { orch, chain, ledger, signCalls } = setup();
    const out = await orch.run(pay("1.2"));
    expect(out.status).toBe("blocked");
    expect(signCalls()).toBe(0);
    expect(chain.calls).toEqual([]);
    expect(ledger.all().map((e) => e.type)).toEqual(["proposal", "policy_check"]);
    expect(ledger.all()[1]?.summary).toMatch(/^Blocked: transfer 1\.2 wNEAR exceeds per-tx limit \(0\.05 wNEAR\)\. Policy v3 · [0-9a-f]{6}\.$/);
  });

  it("to an unapproved counterparty: blocked, signer untouched", async () => {
    const { orch, chain, signCalls } = setup();
    const out = await orch.run(pay("0.01", "attacker.near"));
    expect(out.status).toBe("blocked");
    expect(signCalls()).toBe(0);
    expect(chain.calls).toEqual([]);
  });

  it("an external swarm agent's proposal is blocked as untrusted", async () => {
    const { orch, chain, signCalls } = setup();
    const { check } = await orch.checkOnly(
      { id: "swarm-1", kind: "transfer", agent: "swarm:yield-bot", chain: "near", protocol: "intents.near", from: "dao-treasury.near", legs: [{ to: "vendor.near", asset: W, amount: near("0.01") }], reason: "x", created_at: new Date().toISOString() },
      "procurement",
    );
    expect(check.result).toBe("block");
    expect(check.summary).toMatch(/untrusted/);
    expect(signCalls()).toBe(0);
    expect(chain.calls).toEqual([]);
  });

  it("a per-day overrun on a later run is blocked by ledger-derived accumulation", async () => {
    const { orch, signCalls } = setup();
    for (let i = 0; i < 3; i++) expect((await orch.run(pay("0.05"))).status).toBe("completed");
    const before = signCalls();
    // 3 × (0.05 + 0.0005 fee) = 0.1515 moved; another 0.05 would exceed 0.20
    const out = await orch.run(pay("0.05"));
    expect(out.status).toBe("blocked");
    expect(signCalls()).toBe(before);
  });
});

describe("kill switch", () => {
  it("halts a running loop mid-flight and records the halt", async () => {
    const { orch, chain, killSwitch, ledger, treasurySign, revenueSign } = setup();
    chain.onTrack = () => killSwitch.engage("operator pressed halt"); // engaged while waiting for finality
    const out = await orch.run(pay("0.01"));
    expect(out).toMatchObject({ status: "halted", stage: "fee proposal" });
    expect(treasurySign).toHaveBeenCalledTimes(1); // the principal only
    expect(revenueSign).not.toHaveBeenCalled();
    const last = ledger.all().at(-1);
    expect(last).toMatchObject({ type: "halt", result: "halted" });
    expect(last?.summary).toBe("Halted before fee proposal: operator pressed halt.");
    expect(ledger.all().some((e) => e.type === "fee")).toBe(false);
  });

  it("halts before anything when engaged at start", async () => {
    const { orch, chain, killSwitch, ledger, signCalls } = setup();
    killSwitch.engage("maintenance");
    const out = await orch.run(pay("0.01"));
    expect(out.status).toBe("halted");
    expect(signCalls()).toBe(0);
    expect(chain.calls).toEqual([]);
    expect(ledger.all().map((e) => e.type)).toEqual(["halt"]);
  });

  it("config kill_switch: true halts too", async () => {
    const { orch, signCalls } = setup(FIXTURE_YAML.replace("kill_switch: false", "kill_switch: true"));
    expect((await orch.run(pay("0.01"))).status).toBe("halted");
    expect(signCalls()).toBe(0);
  });
});

describe("reconcile after a halt", () => {
  it("charges the missing fee and split exactly once", async () => {
    const { orch, chain, killSwitch, ledger, treasurySign, revenueSign } = setup();
    chain.onTrack = () => killSwitch.engage("halt mid-flight");
    expect((await orch.run(pay("0.01"))).status).toBe("halted");
    chain.onTrack = undefined;

    // Halted: still refuses to do anything.
    expect((await orch.reconcile()).status).toBe("halted");
    expect(treasurySign).toHaveBeenCalledTimes(1);

    killSwitch.release();
    const r = await orch.reconcile();
    expect(r).toMatchObject({ status: "completed", handled: 1 });
    expect(treasurySign).toHaveBeenCalledTimes(2); // + fee
    expect(revenueSign).toHaveBeenCalledTimes(1); // + split
    const fee = ledger.all().find((e) => e.type === "fee");
    const principal = ledger.all().find((e) => e.type === "settlement");
    expect(fee).toBeDefined();
    // the fee's chain leads back to the halted run's principal settlement
    const feeProposal = ledger.all().find((e) => e.type === "proposal" && (e.payload as { kind?: string }).kind === "fee");
    expect(feeProposal?.upstream).toEqual([principal?.id]);

    const again = await orch.reconcile();
    expect(again).toMatchObject({ status: "completed", handled: 0 });
    expect(treasurySign).toHaveBeenCalledTimes(2);
    expect(verifyChain(ledger.all())).toEqual({ ok: true });
  });

  it("a completed loop leaves nothing to reconcile", async () => {
    const { orch } = setup();
    await orch.run(pay("0.01"));
    expect(await orch.reconcile()).toMatchObject({ status: "completed", handled: 0 });
  });
});

describe("agent boundaries", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const code = (f: string) => src(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  it.each(["treasury.ts", "accounting.ts", "stubs.ts"])("%s cannot reach signing or settlement", (f) => {
    expect(code(f)).not.toMatch(/@athera\/settlement|@athera\/ledger|Ed25519Key|IntentSigner|execute_intents|\.\/orchestrator/);
  });
  it("treasury imports policy types only", () => {
    expect(src("treasury.ts")).toMatch(/^import type \{[^}]+\} from "@athera\/policy";$/m);
    expect(src("treasury.ts").match(/^import /gm)).toHaveLength(1);
  });
});
