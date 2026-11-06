// NEAR AI Cloud client (OpenAI-compatible). Prices come from the public /v1/models list,
// so every call can be costed before it is made (policy check) and after (ledger cost entry).

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ModelPrice {
  /** USD per million input tokens. */
  readonly input: number;
  /** USD per million output tokens. */
  readonly output: number;
}

export interface ChatResult {
  readonly model: string;
  readonly content: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** "stop", or "length" when the output budget ran out (reasoning models can spend it all). */
  readonly finishReason?: string;
  /** Billed cost in micro-USD, from the reported token usage and the listed price. */
  readonly costMicros: bigint;
}

export const NEARAI_BASE_URL = "https://cloud-api.near.ai/v1";

/** micro-USD for `tokens` at `usdPerMillion`: tokens × price exactly, rounded up. */
const micros = (tokens: number, usdPerMillion: number) => Math.ceil(tokens * usdPerMillion);

/** Conservative token estimate for text we have not tokenized (about 3 chars per token). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3) + 8;

export class NearAiClient {
  private prices: Map<string, ModelPrice> | undefined;
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string | undefined,
    opts: { baseUrl?: string; fetch?: FetchLike } = {},
  ) {
    this.baseUrl = opts.baseUrl ?? NEARAI_BASE_URL;
    this.fetch = opts.fetch ?? ((u, i) => fetch(u, i));
  }

  get hasKey(): boolean {
    return !!this.apiKey;
  }

  async price(model: string): Promise<ModelPrice> {
    if (!this.prices) {
      const res = await this.fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`NEAR AI model list failed: HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { id: string; pricing?: { input?: number | string; output?: number | string } }[] };
      this.prices = new Map();
      for (const m of body.data ?? []) {
        const input = Number(m.pricing?.input);
        const output = Number(m.pricing?.output);
        if (Number.isFinite(input) && Number.isFinite(output)) this.prices.set(m.id, { input, output });
      }
    }
    const p = this.prices.get(model);
    if (!p) throw new Error(`NEAR AI lists no price for ${model}`);
    return p;
  }

  /** Worst-case cost of a call: estimated prompt tokens plus the full output budget. */
  async projectCostMicros(model: string, messages: readonly ChatMessage[], maxTokens: number): Promise<bigint> {
    const p = await this.price(model);
    const promptTokens = messages.reduce((s, m) => s + estimateTokens(m.content), 0);
    return BigInt(micros(promptTokens, p.input) + micros(maxTokens, p.output));
  }

  async chat(req: { model: string; messages: readonly ChatMessage[]; maxTokens: number; json?: boolean }): Promise<ChatResult> {
    if (!this.apiKey) throw new Error("NEARAI_API_KEY is not set");
    const p = await this.price(req.model);
    const res = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: 0.2,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      // Never echo the request (it carries the key); the status and a short body are enough.
      const text = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`NEAR AI chat failed: HTTP ${res.status} ${text}`);
    }
    const body = (await res.json()) as {
      model?: string;
      choices?: { finish_reason?: string; message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    const finish = body.choices?.[0]?.finish_reason;
    const promptTokens = body.usage?.prompt_tokens ?? 0;
    const completionTokens = body.usage?.completion_tokens ?? 0;
    return {
      model: req.model,
      content,
      promptTokens,
      completionTokens,
      ...(finish ? { finishReason: finish } : {}),
      costMicros: BigInt(micros(promptTokens, p.input) + micros(completionTokens, p.output)),
    };
  }
}

/** Pull the first JSON object out of a model reply (tolerates code fences and stray text). */
export function parseJsonReply<T>(content: string): T {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model reply has no JSON object");
  return JSON.parse(content.slice(start, end + 1)) as T;
}
