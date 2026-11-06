// Orders from outside customers. A customer pays a 1Click deposit address from any supported
// chain; 1Click's solvers deliver USDC to Athera's revenue account inside intents.near. Creating
// an order needs no keys (the web server can do it); fulfilling one (ledger, split, report) runs
// in the key-holding process.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AccountId, type PolicyCheck, type PolicyConfig, type PolicyEngine, type PolicyState } from "@athera/policy";
import type { OneClickClient, OneClickToken } from "./oneclick.ts";
import { SalesAgent } from "./sales.ts";

export type OrderStatus = "awaiting_payment" | "paid" | "fulfilled" | "refunded" | "failed";

export interface Order {
  readonly id: string;
  readonly created_at: string;
  readonly product: string;
  readonly subject: string;
  readonly price_usd: string;
  readonly origin: { readonly asset: string; readonly symbol: string; readonly chain: string; readonly decimals: number };
  readonly deposit_address: string;
  /** Base units of the origin asset, and the human form. */
  readonly amount_in: string;
  readonly amount_in_formatted: string;
  readonly amount_out: string;
  readonly destination_asset: string;
  readonly recipient: string;
  readonly refund_to: string;
  readonly deadline: string;
  readonly quote_signature: string;
  readonly offer_check: { readonly result: string; readonly summary: string; readonly policy_hash: string };
  status: OrderStatus;
  report_id?: string;
  sale_entry?: string;
  updated_at?: string;
}

const SAFE_ID = /^o[0-9a-z]{8,24}$/;
export const newOrderId = (now = new Date()) =>
  `o${now.toISOString().replace(/[-:TZ.]/g, "").slice(2, 14)}${Math.random().toString(36).slice(2, 8)}`;

export class FileOrderStore {
  constructor(private readonly dir: string) {}
  save(o: Order): void {
    if (!SAFE_ID.test(o.id)) throw new Error(`unsafe order id ${o.id}`);
    mkdirSync(this.dir, { recursive: true });
    const tmp = join(this.dir, `.${o.id}.tmp`);
    writeFileSync(tmp, JSON.stringify(o, null, 2) + "\n");
    renameSync(tmp, join(this.dir, `${o.id}.json`));
  }
  get(id: string): Order | undefined {
    if (!SAFE_ID.test(id)) return undefined;
    const p = join(this.dir, `${id}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Order) : undefined;
  }
  list(): Order[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as Order)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

export class MemoryOrderStore {
  private readonly m = new Map<string, Order>();
  save(o: Order): void {
    this.m.set(o.id, structuredClone(o));
  }
  get(id: string): Order | undefined {
    const o = this.m.get(id);
    return o ? structuredClone(o) : undefined;
  }
  list(): Order[] {
    return [...this.m.values()];
  }
}

export type OrderStore = Pick<FileOrderStore, "save" | "get" | "list">;

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Create an order: check the offer against policy (pricing_rule), then ask 1Click for a quote
 * that delivers exactly the price in the settle asset to the revenue account. Nothing is signed.
 */
export async function createOrder(
  d: { policy: PolicyEngine; oneclick: OneClickClient; orders: OrderStore; state: PolicyState; accountExists: (id: string) => Promise<boolean> },
  req: { subject: string; originAsset: string; refundTo: string; price_usd?: string },
  now = new Date(),
): Promise<{ order: Order; check: PolicyCheck }> {
  const cfg: Readonly<PolicyConfig> = d.policy.config;
  if (!cfg.sales) throw new OrderError("nothing is for sale under the current policy", 409);
  const subject = req.subject.trim().toLowerCase();
  if (!AccountId.safeParse(subject).success) throw new OrderError("that is not a valid NEAR account ID");
  const refundTo = req.refundTo.trim();
  if (!refundTo || refundTo.length > 128 || /\s/.test(refundTo)) throw new OrderError("enter the address on the paying chain where a refund should go");

  const tokens = await d.oneclick.tokens();
  const origin: OneClickToken | undefined = tokens.find((t) => t.assetId === req.originAsset);
  if (!origin) throw new OrderError("1Click does not list that token");
  if (!(await d.accountExists(subject))) throw new OrderError(`${subject} does not exist on NEAR mainnet`);

  const id = newOrderId(now);
  const sales = new SalesAgent(cfg);
  // External customers are identified by their order, not a NEAR account: the offer names "external".
  const sale = cfg.sales;
  const priced = (price_usd?: string) => {
    const offer = sales.offer(`${id}-o`, { customer: "external", subject, ...(price_usd ? { price_usd } : {}) }, now);
    const c = d.policy.validate(offer, d.state);
    if (c.result === "block") throw new OrderError(c.summary, 409);
    return { check: c, price: offer.offer!.price_usd };
  };
  let { check, price } = priced(req.price_usd);
  const ask = (p: string) =>
    d.oneclick.quote({
      originAsset: origin.assetId,
      destinationAsset: sale.settle_asset,
      amountOut: sales.settleAmount(p),
      recipient: cfg.accounts.revenue,
      refundTo,
      deadline: new Date(now.getTime() + 60 * 60_000),
      depositType: "ORIGIN_CHAIN",
    });
  const reason = (e: unknown) => (e instanceof Error ? e.message.replace(/^1Click quote failed: /, "") : String(e));
  let quote;
  try {
    quote = await ask(price);
  } catch (e) {
    // Bridged payments have a minimum. If it fits inside the policy's price bounds, quote at the
    // minimum (+5%, rounded up to the cent) and re-check that price; otherwise say so plainly.
    const min = /try at least (\d+)/.exec(reason(e))?.[1];
    if (!min) throw new OrderError(`1Click could not quote this payment: ${reason(e)}`);
    const needUsd = (Number(min) / 10 ** origin.decimals) * origin.price * 1.05;
    const bumped = (Math.ceil(needUsd * 100) / 100).toFixed(2);
    if (Number(bumped) > Number(sale.max_price_usd)) {
      throw new OrderError(`Payments in ${origin.symbol} on ${origin.blockchain} need at least about $${needUsd.toFixed(2)}, above the $${sale.max_price_usd} price limit. Pay with a NEAR token instead.`);
    }
    if (Number(bumped) > Number(price)) ({ check, price } = priced(bumped));
    try {
      quote = await ask(price);
    } catch (e2) {
      throw new OrderError(`1Click could not quote this payment: ${reason(e2)}`);
    }
  }
  const order: Order = {
    id,
    created_at: now.toISOString(),
    product: cfg.sales.product,
    subject,
    price_usd: price,
    origin: { asset: origin.assetId, symbol: origin.symbol, chain: origin.blockchain, decimals: origin.decimals },
    deposit_address: quote.depositAddress,
    amount_in: quote.amountIn,
    amount_in_formatted: quote.amountInFormatted,
    amount_out: quote.amountOut,
    destination_asset: cfg.sales.settle_asset,
    recipient: cfg.accounts.revenue,
    refund_to: refundTo,
    deadline: quote.deadline,
    quote_signature: quote.signature,
    offer_check: { result: check.result, summary: check.summary, policy_hash: check.policy.hash },
    status: "awaiting_payment",
  };
  d.orders.save(order);
  return { order, check };
}
