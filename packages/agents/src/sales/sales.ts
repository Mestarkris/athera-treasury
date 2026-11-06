// Sales agent. Allowed: offer Athera's product at a price inside the configured bounds, and
// prepare the purchase of a 1Click quote that pays Athera. Forbidden: signing or moving value;
// the policy engine checks the offer (pricing_rule) and the purchase (purchase_rule).
import { parseUnits, type PolicyConfig, type Proposal } from "@athera/policy";
import type { OneClickQuote } from "./oneclick.ts";

export interface SaleOrder {
  /** Account that pays. In the self-run demo this is the treasury Athera has custody for. */
  readonly customer: string;
  /** Account the report is about. */
  readonly subject: string;
  /** USD price; defaults to the configured minimum. */
  readonly price_usd?: string;
}

export class SalesAgent {
  readonly id = "sales" as const;
  constructor(private readonly config: Readonly<PolicyConfig>) {}

  private get sales(): NonNullable<PolicyConfig["sales"]> {
    if (!this.config.sales) throw new Error("config.yaml has no sales section; nothing is for sale");
    return this.config.sales;
  }

  offer(proposalId: string, o: SaleOrder, now = new Date()): Proposal {
    const c = this.config;
    return {
      id: proposalId,
      kind: "sale_offer",
      agent: this.id,
      chain: "near",
      protocol: c.verifier,
      from: c.accounts.revenue,
      legs: [],
      offer: { product: this.sales.product, price_usd: o.price_usd ?? this.sales.min_price_usd, customer: o.customer, subject: o.subject },
      reason: `offer ${this.sales.product} on ${o.subject} to ${o.customer}`,
      created_at: now.toISOString(),
    };
  }

  /** Price in base units of the settle asset (what the revenue account must receive). */
  settleAmount(price_usd: string): string {
    const a = this.config.assets.find((x) => x.id === this.sales.settle_asset);
    if (!a) throw new Error("settle asset has no decimals in config");
    return parseUnits(price_usd, a.decimals).toString();
  }

  /** The customer pays the quote's deposit address from its Intents balance, exactly amountIn. */
  purchase(proposalId: string, customer: string, q: OneClickQuote, now = new Date()): Proposal {
    return {
      id: proposalId,
      kind: "service_purchase",
      agent: "treasury",
      chain: "near",
      protocol: this.config.verifier,
      from: customer,
      legs: [{ to: q.depositAddress, asset: q.originAsset, amount: q.amountIn }],
      quote: {
        provider: "1click",
        depositAddress: q.depositAddress,
        originAsset: q.originAsset,
        destinationAsset: q.destinationAsset,
        amountIn: q.amountIn,
        amountOut: q.amountOut,
        recipient: q.recipient,
        recipientType: "INTENTS",
        deadline: q.deadline,
        signature: q.signature,
      },
      reason: `buy ${this.sales.product} for $${q.amountOutUsd || "?"} via 1Click`,
      created_at: now.toISOString(),
    };
  }
}
