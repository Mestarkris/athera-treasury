import { describe, expect, it } from "vitest";
import { expectedFee, expectedSplit, isMintedCheck, parseUnits, type PolicyCheck, type RuleId } from "../src/index.ts";
import { FIXTURE_YAML, W, engine, near, state, transfer } from "./fixtures.ts";

const e = engine();
const rule = (c: PolicyCheck, id: RuleId) => c.rules.find((r) => r.rule === id);
const expectBlockedBy = (c: PolicyCheck, id: RuleId) => {
  expect(c.result).toBe("block");
  expect(rule(c, id)?.status).toBe("block");
};
const expectPassed = (c: PolicyCheck, id: RuleId) => {
  expect(rule(c, id)?.status).toBe("pass");
};

describe("config loading", () => {
  it("hashes the exact config bytes and exposes the version", () => {
    expect(e.ref.version).toBe(3);
    expect(e.ref.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(engine(FIXTURE_YAML + "\n# comment").ref.hash).not.toBe(e.ref.hash);
  });
  it("rejects a split that does not sum to 100", () => {
    expect(() => engine(FIXTURE_YAML.replace("pct: 30", "pct: 31"))).toThrow(/sum to 101/);
  });
  it("rejects placeholder account IDs", () => {
    expect(() => engine(FIXTURE_YAML.replace("dao-treasury.near", "PENDING-treasury"))).toThrow(/valid NEAR account/);
  });
  it("loads the repo config.yaml schema-wise except for pending accounts", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../../config.yaml", import.meta.url), "utf8");
    const filled = src.replace(/PENDING-[a-z]+-account/g, "x.near");
    expect(() => engine(filled)).not.toThrow();
  });
});

describe("a valid proposal", () => {
  it("passes every applicable rule and is minted", () => {
    const c = e.validate(transfer(), state());
    expect(c.result).toBe("pass");
    expect(isMintedCheck(c)).toBe(true);
    expect(c.summary).toMatch(/^Passed: transfer 0\.01 wNEAR .* Policy v3 · [0-9a-f]{6}\.$/);
  });
  it("is not minted when copied (forgery)", () => {
    const c = e.validate(transfer(), state());
    expect(isMintedCheck({ ...c })).toBe(false);
  });
});

describe("kill_switch", () => {
  it("passes when off", () => expectPassed(e.validate(transfer(), state()), "kill_switch"));
  it("blocks when config kill_switch is true", () => {
    const k = engine(FIXTURE_YAML.replace("kill_switch: false", "kill_switch: true"));
    expectBlockedBy(k.validate(transfer(), state()), "kill_switch");
  });
  it("blocks when the operator halt is engaged", () => {
    expectBlockedBy(e.validate(transfer(), state({ halted: true })), "kill_switch");
  });
});

describe("agent_authorized", () => {
  it("passes treasury → transfer", () => expectPassed(e.validate(transfer(), state()), "agent_authorized"));
  it("blocks treasury → fee", () => expectBlockedBy(e.validate(transfer({ kind: "fee" }), state()), "agent_authorized"));
  it("blocks any swarm agent (untrusted)", () =>
    expectBlockedBy(e.validate(transfer({ agent: "swarm:research-bot" }), state()), "agent_authorized"));
  it("blocks malformed input without throwing", () => {
    const c = e.validate({ id: "x", kind: "steal" }, state());
    expect(c.result).toBe("block");
    expect(c.summary).toMatch(/^Blocked: proposal is malformed/);
  });
});

describe("chain / protocol / asset", () => {
  it("passes approved", () => {
    const c = e.validate(transfer(), state());
    expectPassed(c, "chain_approved");
    expectPassed(c, "protocol_approved");
    expectPassed(c, "asset_approved");
  });
  it("blocks unapproved chain", () => expectBlockedBy(e.validate(transfer({ chain: "eth" }), state()), "chain_approved"));
  it("blocks unapproved protocol", () =>
    expectBlockedBy(e.validate(transfer({ protocol: "evil.near" }), state()), "protocol_approved"));
  it("blocks unapproved asset", () =>
    expectBlockedBy(
      e.validate(transfer({ legs: [{ to: "vendor.near", asset: "nep141:usdc.near", amount: "1" }] }), state()),
      "asset_approved",
    ));
});

describe("source_account", () => {
  it("passes treasury outflow", () => expectPassed(e.validate(transfer(), state()), "source_account"));
  it("blocks a transfer from another account", () =>
    expectBlockedBy(e.validate(transfer({ from: "someone.near" }), state()), "source_account"));
});

describe("counterparty_approved", () => {
  it("passes approved vendor", () => expectPassed(e.validate(transfer(), state()), "counterparty_approved"));
  it("blocks unknown receiver", () =>
    expectBlockedBy(e.validate(transfer({ legs: [{ to: "attacker.near", asset: W, amount: near("0.01") }] }), state()), "counterparty_approved"));
  it("blocks a proposal with no legs", () =>
    expectBlockedBy(e.validate(transfer({ legs: [] }), state()), "counterparty_approved"));
});

describe("per_tx_limit", () => {
  it("passes at exactly the limit", () =>
    expectPassed(e.validate(transfer({ legs: [{ to: "vendor.near", asset: W, amount: near("0.05") }] }), state()), "per_tx_limit"));
  it("blocks one base unit over the limit", () => {
    const amt = (parseUnits("0.05", 24) + 1n).toString();
    const c = e.validate(transfer({ legs: [{ to: "vendor.near", asset: W, amount: amt }] }), state());
    expectBlockedBy(c, "per_tx_limit");
    expect(c.summary).toMatch(/^Blocked: transfer 0\.050000000000000000000001 wNEAR exceeds per-tx limit \(0\.05 wNEAR\)\. Policy v3 · /);
  });
  it("blocks zero", () =>
    expectBlockedBy(e.validate(transfer({ legs: [{ to: "vendor.near", asset: W, amount: "0" }] }), state()), "per_tx_limit"));
  it("sums multiple legs of the same asset", () =>
    expectBlockedBy(
      e.validate(
        transfer({ legs: [{ to: "vendor.near", asset: W, amount: near("0.03") }, { to: "client.near", asset: W, amount: near("0.03") }] }),
        state(),
      ),
      "per_tx_limit",
    ));
});

describe("per_day_limit (accumulation)", () => {
  const moved = (s: string) => ({ [`dao-treasury.near|${W}`]: parseUnits(s, 24) });
  it("passes when today's total stays at the limit", () =>
    expectPassed(e.validate(transfer({ legs: [{ to: "vendor.near", asset: W, amount: near("0.05") }] }), state({ movedToday: moved("0.15") })), "per_day_limit"));
  it("blocks when today's accumulated outflow would exceed the limit", () => {
    const c = e.validate(transfer(), state({ movedToday: moved("0.195") }));
    expectBlockedBy(c, "per_day_limit");
    expect(c.summary).toMatch(/to 0\.205 wNEAR, over the per-day limit \(0\.2 wNEAR\)/);
  });
  it("accumulates across a run of sequential proposals", () => {
    let used = 0n;
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      const c = e.validate(
        transfer({ id: `p-${i}`, legs: [{ to: "vendor.near", asset: W, amount: near("0.05") }] }),
        state({ movedToday: { [`dao-treasury.near|${W}`]: used }, balances: { [`dao-treasury.near|${W}`]: parseUnits("10", 24) }, peakToday: { [`dao-treasury.near|${W}`]: parseUnits("10", 24) } }),
      );
      results.push(c.result);
      if (c.result === "pass") used += parseUnits("0.05", 24);
    }
    expect(results).toEqual(["pass", "pass", "pass", "pass", "block"]);
  });
});

describe("min_reserve", () => {
  it("passes when reserve kept", () => expectPassed(e.validate(transfer(), state()), "min_reserve"));
  it("blocks when the treasury would drop below the reserve", () =>
    expectBlockedBy(
      e.validate(transfer(), state({ balances: { [`dao-treasury.near|${W}`]: parseUnits("0.105", 24) }, peakToday: { [`dao-treasury.near|${W}`]: parseUnits("0.105", 24) } })),
      "min_reserve",
    ));
  it("skips for non-treasury outflows", () => {
    const fee = 10n ** 20n;
    const c = e.validate(
      { ...transfer({ kind: "revenue_split", agent: "accounting", from: "athera-revenue.near", legs: expectedSplit(e.config, W, fee) }), basis: { ref: "f1", asset: W, amount: fee.toString() } },
      state(),
    );
    expect(rule(c, "min_reserve")?.status).toBe("skip");
  });
});

describe("max_drawdown", () => {
  it("passes inside the limit", () => expectPassed(e.validate(transfer(), state()), "max_drawdown"));
  it("blocks when balance would fall more than 50% below today's peak", () =>
    expectBlockedBy(
      e.validate(transfer(), state({ balances: { [`dao-treasury.near|${W}`]: parseUnits("0.5", 24) }, peakToday: { [`dao-treasury.near|${W}`]: parseUnits("1.02", 24) } })),
      "max_drawdown",
    ));
});

describe("fee_rule", () => {
  const principal = parseUnits("0.01", 24);
  const fee = (amount: bigint, ref = "settle-1") => ({
    ...transfer({ id: "fee-1", kind: "fee", agent: "accounting", legs: [{ to: "athera-revenue.near", asset: W, amount: amount.toString() }] }),
    basis: { ref, asset: W, amount: principal.toString() },
  });
  it("applies the minimum fee when bps is smaller", () => {
    expect(expectedFee(e.config, W, principal)).toBe(parseUnits("0.0001", 24));
    expect(expectedFee(e.config, W, parseUnits("0.05", 24))).toBe(parseUnits("0.0005", 24));
  });
  it("passes the exact fee", () => {
    const c = e.validate(fee(expectedFee(e.config, W, principal)), state());
    expect(c.result).toBe("pass");
    expectPassed(c, "fee_rule");
  });
  it("blocks an overcharge", () => expectBlockedBy(e.validate(fee(parseUnits("0.0002", 24)), state()), "fee_rule"));
  it("blocks an undercharge", () => expectBlockedBy(e.validate(fee(1n), state()), "fee_rule"));
  it("blocks a second fee for the same settlement", () =>
    expectBlockedBy(e.validate(fee(expectedFee(e.config, W, principal)), state({ feeChargedFor: new Set(["settle-1"]) })), "fee_rule"));
  it("blocks a fee sent anywhere but the revenue account", () =>
    expectBlockedBy(
      e.validate({ ...fee(expectedFee(e.config, W, principal)), legs: [{ to: "vendor.near", asset: W, amount: expectedFee(e.config, W, principal).toString() }] }, state()),
      "counterparty_approved",
    ));
});

describe("revenue_split_rule", () => {
  const feeAmt = parseUnits("0.0001", 24) + 7n; // forces a rounding remainder
  const split = (legs = expectedSplit(e.config, W, feeAmt), ref = "fee-1") => ({
    ...transfer({ id: "split-1", kind: "revenue_split", agent: "accounting", from: "athera-revenue.near", legs }),
    basis: { ref, asset: W, amount: feeAmt.toString() },
  });
  it("splits 70/30 with the remainder to the last recipient", () => {
    const legs = expectedSplit(e.config, W, feeAmt);
    expect(legs.map((l) => l.to)).toEqual(["athera-ops.near", "athera-reserve.near"]);
    expect(legs.reduce((s, l) => s + BigInt(l.amount), 0n)).toBe(feeAmt);
  });
  it("passes the exact split", () => {
    const c = e.validate(split(), state());
    expect(c.result).toBe("pass");
    expectPassed(c, "revenue_split_rule");
  });
  it("blocks a skewed split", () => {
    const legs = expectedSplit(e.config, W, feeAmt).map((l, i) => ({ ...l, amount: (BigInt(l.amount) + (i === 0 ? 1n : -1n)).toString() }));
    expectBlockedBy(e.validate(split(legs), state()), "revenue_split_rule");
  });
  it("blocks paying the same fee twice", () =>
    expectBlockedBy(e.validate(split(undefined), state({ splitDoneFor: new Set(["fee-1"]) })), "revenue_split_rule"));
  it("blocks a split drawn from the treasury", () =>
    expectBlockedBy(e.validate({ ...split(), from: "dao-treasury.near" }, state()), "source_account"));
});

describe("inference_budget", () => {
  const spend = (micros: string, model = "z-ai/glm-5.3-flash") =>
    transfer({ id: "inf-1", kind: "inference_spend", agent: "analyst", legs: [], inference_usd_micros: micros, model });
  it("passes an approved model inside the per-call cap and the daily budget", () => {
    const c = e.validate(spend("15000"), state({ inferenceTodayMicros: 500_000n }));
    expect(c.result).toBe("pass");
    expectPassed(c, "inference_budget");
  });
  it("blocks a model that is not approved", () => expectBlockedBy(e.validate(spend("1000", "some/other-model"), state()), "inference_budget"));
  it("blocks a call whose worst case exceeds the per-call cap", () => {
    const c = e.validate(spend("20001"), state());
    expectBlockedBy(c, "inference_budget");
    expect(c.summary).toMatch(/per-call cap \$0\.02/);
  });
  it("blocks when today's inference spend would exceed the daily budget", () =>
    expectBlockedBy(e.validate(spend("15000"), state({ inferenceTodayMicros: 990_000n })), "inference_budget"));
  it("only the analyst may spend on inference", () =>
    expectBlockedBy(e.validate({ ...spend("1000"), agent: "treasury" }, state()), "agent_authorized"));
});

describe("pricing_rule (sale offers)", () => {
  const offer = (price: string, product = "treasury_report") =>
    transfer({ id: "offer-1", kind: "sale_offer", agent: "sales", legs: [], offer: { product, price_usd: price, customer: "client.near", subject: "client.near" } });
  it("passes a price inside the bounds", () => {
    const c = e.validate(offer("0.10"), state());
    expect(c.result).toBe("pass");
    expectPassed(c, "pricing_rule");
  });
  it("passes exactly the minimum", () => expectPassed(e.validate(offer("0.05"), state()), "pricing_rule"));
  it("blocks a price below the minimum", () => {
    const c = e.validate(offer("0.049999"), state());
    expectBlockedBy(c, "pricing_rule");
    expect(c.summary).toMatch(/below the minimum \$0\.05/);
  });
  it("blocks a price above the maximum", () => expectBlockedBy(e.validate(offer("0.51"), state()), "pricing_rule"));
  it("blocks a product Athera does not sell", () => expectBlockedBy(e.validate(offer("0.10", "other"), state()), "pricing_rule"));
  it("moves no value, so movement rules do not apply", () => {
    const c = e.validate(offer("0.10"), state());
    expect(rule(c, "per_tx_limit")?.status).toBe("skip");
    expect(rule(c, "counterparty_approved")?.status).toBe("skip");
  });
});

describe("purchase_rule (paying a 1Click quote)", () => {
  const amountIn = near("0.0139");
  const quote = (over: Record<string, unknown> = {}) => ({
    provider: "1click" as const,
    depositAddress: "a".repeat(64),
    originAsset: W,
    destinationAsset: W,
    amountIn,
    amountOut: near("0.0139"),
    recipient: "athera-revenue.near",
    recipientType: "INTENTS" as const,
    deadline: "2026-11-05T12:30:00.000Z",
    signature: "ed25519:sig",
    ...over,
  });
  const purchase = (q = quote(), legs = [{ to: "a".repeat(64), asset: W, amount: amountIn }]) =>
    transfer({ id: "buy-1", kind: "service_purchase", agent: "treasury", legs, quote: q });
  const withPurchase = engine(FIXTURE_YAML.replace("treasury: [transfer]", "treasury: [transfer, service_purchase]"));
  it("passes an exact payment of a live quote that pays Athera revenue", () => {
    const c = withPurchase.validate(purchase(), state());
    expect(c.result).toBe("pass");
    expectPassed(c, "purchase_rule");
    expectPassed(c, "counterparty_approved");
  });
  it("blocks a quote that pays anyone but Athera's revenue account", () =>
    expectBlockedBy(withPurchase.validate(purchase(quote({ recipient: "attacker.near" })), state()), "purchase_rule"));
  it("blocks an expired quote", () =>
    expectBlockedBy(withPurchase.validate(purchase(quote({ deadline: "2026-11-05T11:59:59.000Z" })), state()), "purchase_rule"));
  it("blocks paying more than the quote asks", () =>
    expectBlockedBy(withPurchase.validate(purchase(quote(), [{ to: "a".repeat(64), asset: W, amount: (BigInt(amountIn) + 1n).toString() }]), state()), "purchase_rule"));
  it("blocks paying any address other than the quote's deposit address", () => {
    const c = withPurchase.validate(purchase(quote(), [{ to: "b".repeat(64), asset: W, amount: amountIn }]), state());
    expectBlockedBy(c, "counterparty_approved");
  });
  it("still applies the treasury's per-tx limit", () => {
    const big = near("0.06");
    expectBlockedBy(withPurchase.validate(purchase(quote({ amountIn: big }), [{ to: "a".repeat(64), asset: W, amount: big }]), state()), "per_tx_limit");
  });
});
