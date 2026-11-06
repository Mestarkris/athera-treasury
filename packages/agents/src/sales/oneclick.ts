// NEAR Intents 1Click API: quotes, status. Athera never routes or bridges itself; 1Click's
// solvers do. We only pay a quote's deposit address with our own signed transfer intent.
import type { FetchLike } from "../ai/nearai.ts";

export const ONECLICK_BASE_URL = "https://1click.chaindefuser.com/v0";

export interface QuoteRequest {
  readonly originAsset: string;
  readonly destinationAsset: string;
  /** EXACT_OUTPUT: what the recipient must receive, in base units of the destination asset. */
  readonly amountOut: string;
  readonly recipient: string;
  readonly refundTo: string;
  /** Basis points, e.g. 100 = 1%. */
  readonly slippageBps?: number;
  readonly deadline: Date;
  readonly dry?: boolean;
  /** INTENTS (default): paid from an Intents balance. ORIGIN_CHAIN: paid on the token's own chain. */
  readonly depositType?: "INTENTS" | "ORIGIN_CHAIN";
}

export interface OneClickQuote {
  readonly depositAddress: string;
  readonly originAsset: string;
  readonly destinationAsset: string;
  readonly amountIn: string;
  readonly amountInFormatted: string;
  readonly amountInUsd: string;
  readonly amountOut: string;
  readonly amountOutUsd: string;
  readonly deadline: string;
  readonly timeEstimate: number;
  readonly signature: string;
  readonly recipient: string;
  readonly correlationId?: string;
}

export type SwapStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export interface StatusResult {
  readonly status: SwapStatus;
  readonly intentHashes: string[];
  readonly nearTxHashes: string[];
  readonly amountOut?: string;
  readonly refundedAmount?: string;
}

export interface OneClickToken {
  readonly assetId: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly blockchain: string;
  /** USD price as listed by 1Click. */
  readonly price: number;
}

export const FINAL_STATUSES: readonly SwapStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];

export class OneClickClient {
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;

  constructor(opts: { baseUrl?: string; fetch?: FetchLike; jwt?: string } = {}) {
    this.baseUrl = opts.baseUrl ?? ONECLICK_BASE_URL;
    const f = opts.fetch ?? ((u, i) => fetch(u, i));
    const jwt = opts.jwt;
    this.fetch = jwt ? (u, i) => f(u, { ...i, headers: { ...(i?.headers as Record<string, string>), authorization: `Bearer ${jwt}` } }) : f;
  }

  private tokenCache: OneClickToken[] | undefined;

  /** Tokens 1Click can route, with USD prices (cached per client). */
  async tokens(): Promise<OneClickToken[]> {
    if (this.tokenCache) return this.tokenCache;
    const res = await this.fetch(`${this.baseUrl}/tokens`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`1Click tokens failed: HTTP ${res.status}`);
    this.tokenCache = ((await res.json()) as OneClickToken[]).map((t) => ({
      assetId: t.assetId,
      symbol: t.symbol,
      decimals: t.decimals,
      blockchain: t.blockchain,
      price: Number(t.price) || 0,
    }));
    return this.tokenCache;
  }

  /**
   * Ask 1Click for a quote that delivers exactly `amountOut` of the destination asset to the
   * recipient inside the verifier, paid from an Intents balance (depositType INTENTS).
   */
  async quote(r: QuoteRequest): Promise<OneClickQuote> {
    const body = {
      dry: r.dry ?? false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: r.slippageBps ?? 100,
      originAsset: r.originAsset,
      depositType: r.depositType ?? "INTENTS",
      destinationAsset: r.destinationAsset,
      amount: r.amountOut,
      refundTo: r.refundTo,
      refundType: r.depositType === "ORIGIN_CHAIN" ? "ORIGIN_CHAIN" : "INTENTS",
      recipient: r.recipient,
      recipientType: "INTENTS",
      deadline: r.deadline.toISOString(),
    };
    const res = await this.fetch(`${this.baseUrl}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      message?: string;
      signature?: string;
      correlationId?: string;
      quote?: Record<string, unknown>;
    };
    if (!res.ok || !json.quote) throw new Error(`1Click quote failed: HTTP ${res.status} ${json.message ?? ""}`.trim());
    const q = json.quote;
    const str = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
    if (!r.dry && !str("depositAddress")) throw new Error("1Click quote has no deposit address");
    return {
      depositAddress: str("depositAddress"),
      originAsset: r.originAsset,
      destinationAsset: r.destinationAsset,
      amountIn: str("amountIn"),
      amountInFormatted: str("amountInFormatted"),
      amountInUsd: str("amountInUsd"),
      amountOut: str("amountOut"),
      amountOutUsd: str("amountOutUsd"),
      deadline: str("deadline") || r.deadline.toISOString(),
      timeEstimate: Number(q.timeEstimate ?? 0),
      signature: json.signature ?? "",
      recipient: r.recipient,
      ...(json.correlationId ? { correlationId: json.correlationId } : {}),
    };
  }

  async status(depositAddress: string): Promise<StatusResult> {
    const res = await this.fetch(`${this.baseUrl}/status?depositAddress=${encodeURIComponent(depositAddress)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`1Click status failed: HTTP ${res.status}`);
    const j = (await res.json()) as {
      status: SwapStatus;
      swapDetails?: { intentHashes?: string[]; nearTxHashes?: { hash: string }[] | string[]; amountOut?: string; refundedAmount?: string };
    };
    const sd = j.swapDetails ?? {};
    const near = (sd.nearTxHashes ?? []).map((h) => (typeof h === "string" ? h : h.hash));
    return {
      status: j.status,
      intentHashes: sd.intentHashes ?? [],
      nearTxHashes: near,
      ...(sd.amountOut ? { amountOut: sd.amountOut } : {}),
      ...(sd.refundedAmount ? { refundedAmount: sd.refundedAmount } : {}),
    };
  }

  /** Poll until SUCCESS / REFUNDED / FAILED or the timeout. */
  async waitFinal(
    depositAddress: string,
    opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; onStatus?: (s: StatusResult) => void } = {},
  ): Promise<StatusResult> {
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
    let last: StatusResult | undefined;
    for (;;) {
      last = await this.status(depositAddress);
      opts.onStatus?.(last);
      if (FINAL_STATUSES.includes(last.status)) return last;
      if (Date.now() > deadline) throw new Error(`1Click swap still ${last.status} after timeout`);
      await sleep(opts.intervalMs ?? 3_000);
    }
  }
}
