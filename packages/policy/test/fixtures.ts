import { PolicyEngine, type PolicyState, type Proposal, parseUnits } from "../src/index.ts";

export const W = "nep141:wrap.near";
export const near = (s: string) => parseUnits(s, 24).toString();

export const FIXTURE_YAML = `
version: 3
network: mainnet
verifier: intents.near
kill_switch: false
assets:
  - { id: "nep141:wrap.near", symbol: wNEAR, decimals: 24 }
  - { id: "nep141:usdc.near", symbol: USDC, decimals: 6 }
approved:
  chains: [near]
  assets: ["nep141:wrap.near"]
  protocols: [intents.near]
accounts:
  treasury: dao-treasury.near
  revenue: athera-revenue.near
limits:
  inference_spend_per_day_usd: "1.00"
  capital_movement:
    "nep141:wrap.near": { per_tx: "0.05", per_day: "0.20" }
risk:
  max_drawdown_pct: 50
  min_reserve: { "nep141:wrap.near": "0.10" }
fees:
  fee_bps: 100
  min_fee: { "nep141:wrap.near": "0.0001" }
revenue_split:
  - { account: athera-ops.near, label: operations, pct: 70 }
  - { account: athera-reserve.near, label: reserve, pct: 30 }
counterparties:
  - { account: vendor.near, role: vendor, label: Vendor }
  - { account: client.near, role: client, label: Client }
agents:
  treasury: [transfer]
  accounting: [fee, revenue_split]
  procurement: [vendor_payment]
  sales: [sale_offer]
  analyst: [inference_spend]
sales:
  product: treasury_report
  min_price_usd: "0.05"
  max_price_usd: "0.50"
  settle_asset: "nep141:wrap.near"
inference:
  provider: cloud-api.near.ai
  approved_models: [z-ai/glm-5.3-flash]
  max_call_usd: "0.02"
`;

export const engine = (yaml = FIXTURE_YAML) => PolicyEngine.fromSource(yaml);

export function state(over: Partial<PolicyState> = {}): PolicyState {
  return {
    now: new Date("2026-11-05T12:00:00.000Z"),
    halted: false,
    movedToday: {},
    inferenceTodayMicros: 0n,
    balances: { [`dao-treasury.near|${W}`]: parseUnits("0.5", 24), [`athera-revenue.near|${W}`]: parseUnits("0.01", 24) },
    peakToday: { [`dao-treasury.near|${W}`]: parseUnits("0.5", 24) },
    feeChargedFor: new Set(),
    splitDoneFor: new Set(),
    ...over,
  };
}

export function transfer(over: Partial<Proposal> = {}): Proposal {
  return {
    id: "p-1",
    kind: "transfer",
    agent: "treasury",
    chain: "near",
    protocol: "intents.near",
    from: "dao-treasury.near",
    legs: [{ to: "vendor.near", asset: W, amount: near("0.01") }],
    reason: "pay vendor invoice",
    created_at: "2026-11-05T12:00:00.000Z",
    ...over,
  };
}
