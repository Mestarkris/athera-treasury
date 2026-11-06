import type { PolicyConfig, Proposal, TransferLeg } from "./schema.ts";
import { formatUnits, parseUnits, usdToMicros } from "./units.ts";

/** Everything the engine knows about the world at check time. Built from the ledger and chain. */
export interface PolicyState {
  /** Check time. Quote deadlines are compared against it (recorded, so replays are exact). */
  readonly now: Date;
  /** Runtime kill switch (operator halt), independent of `config.kill_switch`. */
  readonly halted: boolean;
  /** Outflows committed today (UTC), including submitted-but-unconfirmed. Key: `${account}|${asset}`. */
  readonly movedToday: Readonly<Record<string, bigint>>;
  readonly inferenceTodayMicros: bigint;
  /** Current balances inside the verifier. Key: `${account}|${asset}`. */
  readonly balances: Readonly<Record<string, bigint>>;
  /** Highest balance observed today. Key: `${account}|${asset}`. */
  readonly peakToday: Readonly<Record<string, bigint>>;
  /** Basis refs that already had a fee charged / a split paid. */
  readonly feeChargedFor: ReadonlySet<string>;
  readonly splitDoneFor: ReadonlySet<string>;
}

export const RULE_IDS = [
  "kill_switch",
  "agent_authorized",
  "chain_approved",
  "protocol_approved",
  "asset_approved",
  "source_account",
  "counterparty_approved",
  "per_tx_limit",
  "per_day_limit",
  "min_reserve",
  "max_drawdown",
  "fee_rule",
  "revenue_split_rule",
  "inference_budget",
  "pricing_rule",
  "purchase_rule",
] as const;
/** `schema` is reported only when a proposal is malformed and no other rule can run. */
export type RuleId = (typeof RULE_IDS)[number] | "schema";

export type RuleStatus = "pass" | "block" | "skip";
export interface RuleResult {
  readonly rule: RuleId;
  readonly status: RuleStatus;
  readonly detail: string;
}

export const key = (account: string, asset: string) => `${account}|${asset}`;

interface Ctx {
  readonly c: PolicyConfig;
  readonly p: Proposal;
  readonly s: PolicyState;
}

const pass = (rule: RuleId, detail: string): RuleResult => ({ rule, status: "pass", detail });
const block = (rule: RuleId, detail: string): RuleResult => ({ rule, status: "block", detail });
const skip = (rule: RuleId, detail: string): RuleResult => ({ rule, status: "skip", detail });

function asset(c: PolicyConfig, id: string) {
  return c.assets.find((a) => a.id === id);
}

/** Human amount like "0.05 wNEAR"; falls back to raw base units for unknown assets. */
export function fmt(c: PolicyConfig, id: string, v: bigint): string {
  const a = asset(c, id);
  return a ? `${formatUnits(v, a.decimals)} ${a.symbol}` : `${v.toString()} (base units of ${id})`;
}

function limit(c: PolicyConfig, id: string, value: string | undefined): bigint | undefined {
  const a = asset(c, id);
  return a && value !== undefined ? parseUnits(value, a.decimals) : undefined;
}

/** Sum of legs grouped by asset. */
function totals(legs: readonly TransferLeg[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const l of legs) m.set(l.asset, (m.get(l.asset) ?? 0n) + BigInt(l.amount));
  return m;
}

const moves = (p: Proposal) => p.kind !== "inference_spend" && p.kind !== "sale_offer";

type Rule = (x: Ctx) => RuleResult;

const rules: Record<(typeof RULE_IDS)[number], Rule> = {
  kill_switch: ({ c, s }) => {
    if (c.kill_switch) return block("kill_switch", "kill switch is on in config.yaml");
    if (s.halted) return block("kill_switch", "operator halt is engaged");
    return pass("kill_switch", "kill switch off");
  },

  agent_authorized: ({ c, p }) => {
    if (p.agent.startsWith("swarm:")) {
      return block("agent_authorized", `${p.agent} is an external agent; its output is untrusted and cannot become an intent directly`);
    }
    const allowed = c.agents[p.agent as keyof typeof c.agents] ?? [];
    return allowed.includes(p.kind)
      ? pass("agent_authorized", `${p.agent} may propose ${p.kind}`)
      : block("agent_authorized", `${p.agent} may not propose ${p.kind}`);
  },

  chain_approved: ({ c, p }) =>
    c.approved.chains.includes(p.chain)
      ? pass("chain_approved", `chain ${p.chain} approved`)
      : block("chain_approved", `chain ${p.chain} is not approved`),

  protocol_approved: ({ c, p }) =>
    c.approved.protocols.includes(p.protocol)
      ? pass("protocol_approved", `protocol ${p.protocol} approved`)
      : block("protocol_approved", `protocol ${p.protocol} is not approved`),

  asset_approved: ({ c, p }) => {
    if (!moves(p)) return skip("asset_approved", "no value movement");
    const bad = p.legs.filter((l) => !c.approved.assets.includes(l.asset));
    return bad.length === 0
      ? pass("asset_approved", "all assets approved")
      : block("asset_approved", `asset ${bad[0]?.asset} is not approved`);
  },

  source_account: ({ c, p }) => {
    if (!moves(p)) return skip("source_account", "no value movement");
    const expected = p.kind === "revenue_split" ? c.accounts.revenue : c.accounts.treasury;
    return p.from === expected
      ? pass("source_account", `${p.kind} draws from ${expected}`)
      : block("source_account", `${p.kind} must draw from ${expected}, not ${p.from}`);
  },

  counterparty_approved: ({ c, p }) => {
    if (!moves(p)) return skip("counterparty_approved", "no value movement");
    if (p.legs.length === 0) return block("counterparty_approved", "proposal moves nothing");
    let allowed: string[];
    switch (p.kind) {
      case "fee":
        allowed = [c.accounts.revenue];
        break;
      case "revenue_split":
        allowed = c.revenue_split.map((r) => r.account);
        break;
      case "vendor_payment":
        allowed = c.counterparties.filter((x) => x.role === "vendor").map((x) => x.account);
        break;
      case "service_purchase":
        // The only receiver is the deposit address of the quote being paid (checked by purchase_rule).
        allowed = p.quote ? [p.quote.depositAddress] : [];
        break;
      default:
        allowed = c.counterparties.map((x) => x.account);
    }
    const bad = p.legs.find((l) => !allowed.includes(l.to));
    return bad
      ? block("counterparty_approved", `${bad.to} is not an approved counterparty for ${p.kind}`)
      : pass("counterparty_approved", `all receivers approved for ${p.kind}`);
  },

  per_tx_limit: ({ c, p }) => {
    if (!moves(p)) return skip("per_tx_limit", "no value movement");
    for (const [id, amt] of totals(p.legs)) {
      const max = limit(c, id, c.limits.capital_movement[id]?.per_tx);
      if (max === undefined) return block("per_tx_limit", `no per-tx limit configured for ${id}`);
      if (amt <= 0n) return block("per_tx_limit", "amount must be positive");
      if (amt > max) return block("per_tx_limit", `${p.kind} ${fmt(c, id, amt)} exceeds per-tx limit (${fmt(c, id, max)})`);
    }
    return pass("per_tx_limit", "within per-tx limit");
  },

  per_day_limit: ({ c, p, s }) => {
    if (!moves(p)) return skip("per_day_limit", "no value movement");
    for (const [id, amt] of totals(p.legs)) {
      const max = limit(c, id, c.limits.capital_movement[id]?.per_day);
      if (max === undefined) return block("per_day_limit", `no per-day limit configured for ${id}`);
      const used = s.movedToday[key(p.from, id)] ?? 0n;
      if (used + amt > max) {
        return block(
          "per_day_limit",
          `${p.kind} ${fmt(c, id, amt)} would bring today's outflow from ${p.from} to ${fmt(c, id, used + amt)}, over the per-day limit (${fmt(c, id, max)})`,
        );
      }
    }
    return pass("per_day_limit", "within per-day limit");
  },

  min_reserve: ({ c, p, s }) => {
    if (!moves(p) || p.from !== c.accounts.treasury) return skip("min_reserve", "not a treasury outflow");
    for (const [id, amt] of totals(p.legs)) {
      const reserve = limit(c, id, c.risk.min_reserve[id]) ?? 0n;
      const bal = s.balances[key(p.from, id)] ?? 0n;
      if (bal - amt < reserve) {
        return block("min_reserve", `treasury would hold ${fmt(c, id, bal - amt)}, below the reserve (${fmt(c, id, reserve)})`);
      }
    }
    return pass("min_reserve", "reserve preserved");
  },

  max_drawdown: ({ c, p, s }) => {
    if (!moves(p) || p.from !== c.accounts.treasury) return skip("max_drawdown", "not a treasury outflow");
    for (const [id, amt] of totals(p.legs)) {
      const bal = s.balances[key(p.from, id)] ?? 0n;
      const peak = s.peakToday[key(p.from, id)] ?? bal;
      if (peak === 0n) return block("max_drawdown", "treasury has no balance");
      const after = bal - amt;
      // drawdown% = (peak - after) / peak * 100, compared in integers (basis points)
      const ddBps = ((peak - after) * 10_000n) / peak;
      const maxBps = BigInt(Math.round(c.risk.max_drawdown_pct * 100));
      if (ddBps > maxBps) {
        return block("max_drawdown", `drawdown would be ${(Number(ddBps) / 100).toFixed(2)}% of today's peak, over ${c.risk.max_drawdown_pct}%`);
      }
    }
    return pass("max_drawdown", "within drawdown limit");
  },

  fee_rule: ({ c, p, s }) => {
    if (p.kind !== "fee") return skip("fee_rule", "not a fee");
    if (!p.basis) return block("fee_rule", "fee has no settled basis");
    if (s.feeChargedFor.has(p.basis.ref)) return block("fee_rule", `fee already charged for ${p.basis.ref}`);
    const expected = expectedFee(c, p.basis.asset, BigInt(p.basis.amount));
    const leg = p.legs[0];
    if (p.legs.length !== 1 || !leg || leg.asset !== p.basis.asset || BigInt(leg.amount) !== expected) {
      return block("fee_rule", `fee must be exactly ${fmt(c, p.basis.asset, expected)} (${c.fees.fee_bps} bps, min applied)`);
    }
    return pass("fee_rule", `fee ${fmt(c, leg.asset, expected)} = ${c.fees.fee_bps} bps of ${fmt(c, p.basis.asset, BigInt(p.basis.amount))}, min applied`);
  },

  revenue_split_rule: ({ c, p, s }) => {
    if (p.kind !== "revenue_split") return skip("revenue_split_rule", "not a revenue split");
    if (!p.basis) return block("revenue_split_rule", "split has no collected-fee basis");
    if (s.splitDoneFor.has(p.basis.ref)) return block("revenue_split_rule", `split already paid for ${p.basis.ref}`);
    const expected = expectedSplit(c, p.basis.asset, BigInt(p.basis.amount));
    const same =
      expected.length === p.legs.length &&
      expected.every((e, i) => {
        const l = p.legs[i];
        return l && l.to === e.to && l.asset === e.asset && l.amount === e.amount;
      });
    return same
      ? pass("revenue_split_rule", `split matches ${c.revenue_split.map((r) => `${r.pct}%`).join(" / ")}`)
      : block("revenue_split_rule", `split does not match configured ${c.revenue_split.map((r) => `${r.label} ${r.pct}%`).join(", ")}`);
  },

  inference_budget: ({ c, p, s }) => {
    if (p.kind !== "inference_spend") return skip("inference_budget", "not an inference cost");
    if (!c.inference) return block("inference_budget", "this policy version approves no AI model");
    if (!p.model || !c.inference.approved_models.includes(p.model)) {
      return block("inference_budget", `model ${p.model ?? "(none)"} is not an approved model`);
    }
    const cost = BigInt(p.inference_usd_micros ?? "0");
    const perCall = usdToMicros(c.inference.max_call_usd);
    if (cost > perCall) {
      return block("inference_budget", `this call could cost $${formatUnits(cost, 6)}, over the per-call cap $${c.inference.max_call_usd}`);
    }
    const max = usdToMicros(c.limits.inference_spend_per_day_usd);
    const after = s.inferenceTodayMicros + cost;
    return after > max
      ? block("inference_budget", `inference spend today would be $${formatUnits(after, 6)}, over $${c.limits.inference_spend_per_day_usd}`)
      : pass("inference_budget", `inference spend today at most $${formatUnits(after, 6)} of $${c.limits.inference_spend_per_day_usd} (${p.model})`);
  },

  pricing_rule: ({ c, p }) => {
    if (p.kind !== "sale_offer") return skip("pricing_rule", "not a sale offer");
    if (!c.sales) return block("pricing_rule", "this policy version sells nothing");
    if (!p.offer) return block("pricing_rule", "sale offer has no price");
    if (p.offer.product !== c.sales.product) return block("pricing_rule", `product ${p.offer.product} is not sold`);
    const price = usdToMicros(p.offer.price_usd);
    const min = usdToMicros(c.sales.min_price_usd);
    const max = usdToMicros(c.sales.max_price_usd);
    if (price < min) return block("pricing_rule", `price $${p.offer.price_usd} is below the minimum $${c.sales.min_price_usd}`);
    if (price > max) return block("pricing_rule", `price $${p.offer.price_usd} is above the maximum $${c.sales.max_price_usd}`);
    return pass("pricing_rule", `price $${p.offer.price_usd} within $${c.sales.min_price_usd}–$${c.sales.max_price_usd}`);
  },

  purchase_rule: ({ c, p, s }) => {
    if (p.kind !== "service_purchase") return skip("purchase_rule", "not a service purchase");
    const q = p.quote;
    if (!q) return block("purchase_rule", "purchase has no 1Click quote");
    if (!c.sales) return block("purchase_rule", "this policy version sells nothing");
    if (q.recipient !== c.accounts.revenue || q.recipientType !== "INTENTS") {
      return block("purchase_rule", `quote pays ${q.recipient}, not Athera's revenue account inside the verifier`);
    }
    if (q.destinationAsset !== c.sales.settle_asset) {
      return block("purchase_rule", `quote settles in ${q.destinationAsset}, not ${c.sales.settle_asset}`);
    }
    if (Date.parse(q.deadline) <= s.now.getTime()) return block("purchase_rule", "quote has expired");
    const leg = p.legs[0];
    if (p.legs.length !== 1 || !leg || leg.to !== q.depositAddress || leg.asset !== q.originAsset || leg.amount !== q.amountIn) {
      return block("purchase_rule", "payment must be exactly the quote's amountIn of its origin asset to its deposit address");
    }
    return pass("purchase_rule", `pays 1Click quote ${q.depositAddress.slice(0, 10)}… for Athera revenue`);
  },
};

/** fee = max(min_fee, principal * bps / 10_000), rounded down. */
export function expectedFee(c: PolicyConfig, assetId: string, principal: bigint): bigint {
  const pct = (principal * BigInt(c.fees.fee_bps)) / 10_000n;
  const min = limit(c, assetId, c.fees.min_fee[assetId]) ?? 0n;
  return pct > min ? pct : min;
}

/** Split legs in config order; the last recipient receives the rounding remainder. */
export function expectedSplit(c: PolicyConfig, assetId: string, fee: bigint): TransferLeg[] {
  let remaining = fee;
  return c.revenue_split.map((r, i) => {
    const amt = i === c.revenue_split.length - 1 ? remaining : (fee * BigInt(r.pct)) / 100n;
    remaining -= amt;
    return { to: r.account, asset: assetId, amount: amt.toString() };
  });
}

/** Run every rule. Pure: same inputs, same output. */
export function evaluateRules(c: PolicyConfig, p: Proposal, s: PolicyState): RuleResult[] {
  return RULE_IDS.map((id) => rules[id]({ c, p, s }));
}
