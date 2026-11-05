import { base64 } from "@scure/base";

export interface AccessKeyView {
  nonce: number | string;
  block_hash: string;
  permission: "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };
}

export interface ExecutionOutcome {
  id: string;
  block_hash: string;
  outcome: {
    logs: string[];
    status: { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown } | string;
    executor_id: string;
  };
}

export interface FinalTxResult {
  final_execution_status?: string;
  status: { SuccessValue?: string; Failure?: unknown } | string;
  transaction: { hash: string; signer_id: string; receiver_id: string };
  transaction_outcome: ExecutionOutcome;
  receipts_outcome: ExecutionOutcome[];
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly data: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/** Narrow NEAR JSON-RPC client. Everything it reads, a reviewer can re-read with curl. */
// rpc.mainnet.near.org is deprecated and rate-limits with JSON-RPC code -429; not used.
export const DEFAULT_MAINNET_RPCS = ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://near.drpc.org"];

export class NearRpc {
  readonly urls: readonly string[];
  private current = 0;

  /** `url` may be a single endpoint or a comma-separated list; the client rotates on 429/5xx. */
  constructor(
    url: string | readonly string[],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.urls = (typeof url === "string" ? url.split(",") : url).map((u) => u.trim()).filter(Boolean);
    if (this.urls.length === 0) throw new Error("no RPC URL configured");
  }

  get url(): string {
    return this.urls[this.current] ?? this.urls[0] ?? "";
  }

  async call<T>(method: string, params: unknown): Promise<T> {
    // Free public RPCs rate-limit (429) and occasionally 5xx or drop connections: rotate to the
    // next endpoint, backing off after each full cycle. Resending the same signed tx is safe
    // (same hash and nonce), so this also applies to send_tx.
    let res: Response | undefined;
    let lastErr: unknown;
    const tries = this.urls.length * 3;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "athera", method, params }),
        });
        if (res.status !== 429 && res.status < 500) {
          // Some providers signal rate limits inside a 200 response (JSON-RPC error code -429).
          const peek = (await res.clone().json().catch(() => null)) as { error?: { code?: number } } | null;
          if (peek?.error?.code !== -429) break;
          res = undefined;
          lastErr = new Error("JSON-RPC -429 rate limited");
        }
      } catch (e) {
        lastErr = e;
        res = undefined;
      }
      this.current = (this.current + 1) % this.urls.length;
      if ((attempt + 1) % this.urls.length === 0) await new Promise((r) => setTimeout(r, 500 * 2 ** ((attempt + 1) / this.urls.length)));
    }
    if (!res) throw new RpcError(`RPC ${method}: no response (${String(lastErr)})`, lastErr);
    if (!res.ok) throw new RpcError(`RPC ${method} HTTP ${res.status}`, await res.text());
    const body = (await res.json()) as { result?: T & { error?: string }; error?: { message?: string; data?: unknown; cause?: unknown } };
    if (body.error) throw new RpcError(`RPC ${method}: ${body.error.message ?? "error"} ${JSON.stringify(body.error.cause ?? body.error.data ?? "")}`, body.error);
    if (body.result && typeof body.result === "object" && "error" in body.result && typeof body.result.error === "string") {
      throw new RpcError(`RPC ${method}: ${body.result.error}`, body.result);
    }
    return body.result as T;
  }

  async view<T>(contract: string, method: string, args: unknown): Promise<T> {
    const r = await this.call<{ result: number[] }>("query", {
      request_type: "call_function",
      finality: "final",
      account_id: contract,
      method_name: method,
      args_base64: base64.encode(new TextEncoder().encode(JSON.stringify(args))),
    });
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result))) as T;
  }

  accessKey(accountId: string, publicKey: string): Promise<AccessKeyView> {
    return this.call("query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey });
  }

  block(ref: { finality: "final" } | { block_id: string | number }): Promise<{ header: { hash: string; height: number; timestamp_nanosec: string } }> {
    return this.call("block", ref);
  }

  sendTx(signedTxBase64: string, waitUntil: "NONE" | "INCLUDED" | "EXECUTED_OPTIMISTIC" | "FINAL"): Promise<FinalTxResult> {
    return this.call("send_tx", { signed_tx_base64: signedTxBase64, wait_until: waitUntil });
  }

  txStatus(txHash: string, senderId: string, waitUntil: "INCLUDED" | "EXECUTED_OPTIMISTIC" | "FINAL" = "FINAL"): Promise<FinalTxResult> {
    return this.call("tx", { tx_hash: txHash, sender_account_id: senderId, wait_until: waitUntil });
  }
}
