// Analyst agent. Allowed: read public chain data, call an approved AI model through the
// metered path, write reports. Forbidden: proposing or signing any value movement.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnits } from "@athera/policy";
import type { ChatMessage } from "../ai/nearai.ts";
import { parseJsonReply } from "../ai/nearai.ts";
import type { OneClickToken } from "./oneclick.ts";

/** The two read calls the analyst needs; NearRpc satisfies this. */
export interface ChainReader {
  call<T>(method: string, params: unknown): Promise<T>;
  view<T>(contract: string, method: string, args: unknown): Promise<T>;
}

export interface Holding {
  readonly asset: string;
  readonly symbol: string;
  readonly amount: string;
  readonly usd: number | null;
}

export interface AccountFacts {
  readonly account: string;
  readonly read_at: string;
  readonly block_height: number;
  readonly native_near: string;
  readonly native_usd: number | null;
  readonly storage_bytes: number;
  readonly is_contract: boolean;
  /** Balances held inside the intents.near verifier. */
  readonly intents: readonly Holding[];
  readonly total_usd: number;
}

export interface Analysis {
  readonly headline: string;
  readonly summary: string;
  readonly observations: readonly string[];
  readonly risks: readonly string[];
  readonly recommendations: readonly string[];
}

export interface Report {
  readonly id: string;
  readonly created_at: string;
  readonly product: string;
  readonly subject: string;
  readonly customer: string;
  readonly price_usd: string;
  readonly facts: AccountFacts;
  readonly analysis: Analysis;
  readonly model: string;
  readonly cost_usd: string;
  /** Ledger entries a reader can follow: offer check, sale, AI cost. */
  readonly ledger: { readonly sale?: string; readonly cost?: string; readonly offer?: string };
  readonly payment?: { readonly deposit_address: string; readonly intent_hashes: readonly string[]; readonly near_tx_hashes: readonly string[] };
}

const NEAR_DECIMALS = 24;
const round = (n: number) => Math.round(n * 100) / 100;

export async function gatherFacts(rpc: ChainReader, verifier: string, account: string, tokens: readonly OneClickToken[]): Promise<AccountFacts> {
  const view = await rpc.call<{ amount: string; storage_usage: number; code_hash: string; block_height: number }>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: account,
  });
  const byId = new Map(tokens.map((t) => [t.assetId, t]));
  const nearPrice = byId.get("nep141:wrap.near")?.price ?? null;
  const nativeNear = formatUnits(BigInt(view.amount), NEAR_DECIMALS);

  const owned = await rpc.view<{ token_id: string }[]>(verifier, "mt_tokens_for_owner", { account_id: account, limit: 50 });
  const ids = owned.map((t) => t.token_id);
  const balances = ids.length ? await rpc.view<string[]>(verifier, "mt_batch_balance_of", { account_id: account, token_ids: ids }) : [];
  const intents: Holding[] = [];
  ids.forEach((id, i) => {
    const raw = BigInt(balances[i] ?? "0");
    if (raw === 0n) return;
    const t = byId.get(id);
    const amount = t ? formatUnits(raw, t.decimals) : raw.toString();
    intents.push({ asset: id, symbol: t?.symbol ?? id, amount, usd: t ? round(Number(amount) * t.price) : null });
  });
  const nativeUsd = nearPrice === null ? null : round(Number(nativeNear) * nearPrice);
  const total = round((nativeUsd ?? 0) + intents.reduce((s, h) => s + (h.usd ?? 0), 0));
  return {
    account,
    read_at: new Date().toISOString(),
    block_height: view.block_height,
    native_near: nativeNear,
    native_usd: nativeUsd,
    storage_bytes: view.storage_usage,
    is_contract: view.code_hash !== "11111111111111111111111111111111",
    intents,
    total_usd: total,
  };
}

/** Prompt for the report. The facts are the only source; the model must not invent numbers. */
export function reportPrompt(facts: AccountFacts): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a treasury analyst for DAOs on NEAR. Write a short, plain-English treasury review from the JSON facts you are given. " +
        "Use only numbers present in the facts; never invent balances, prices or history. Be specific and practical. " +
        'Reply with one JSON object: {"headline": string (max 90 chars), "summary": string (2-3 sentences), ' +
        '"observations": string[] (3-5), "risks": string[] (2-4), "recommendations": string[] (3-5, concrete policy settings such as reserve floors, per-transaction limits, diversification)}.',
    },
    { role: "user", content: JSON.stringify(facts) },
  ];
}

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max).map((x) => x.trim().slice(0, 400)) : [];

/** Accept only the expected shape; anything missing becomes an empty field, never a crash. */
export function parseAnalysis(content: string): Analysis {
  const j = parseJsonReply<Record<string, unknown>>(content);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const a: Analysis = {
    headline: str(j["headline"], 120),
    summary: str(j["summary"], 800),
    observations: strings(j["observations"], 6),
    risks: strings(j["risks"], 5),
    recommendations: strings(j["recommendations"], 6),
  };
  if (!a.headline || !a.summary) throw new Error("model reply is missing a headline or summary");
  return a;
}

export interface ReportStore {
  save(r: Report): void;
  get(id: string): Report | undefined;
  list(): Report[];
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export class FileReportStore implements ReportStore {
  constructor(private readonly dir: string) {}
  save(r: Report): void {
    if (!SAFE_ID.test(r.id)) throw new Error(`unsafe report id ${r.id}`);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${r.id}.json`), JSON.stringify(r, null, 2) + "\n");
  }
  get(id: string): Report | undefined {
    if (!SAFE_ID.test(id)) return undefined;
    const p = join(this.dir, `${id}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Report) : undefined;
  }
  list(): Report[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as Report)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

export class MemoryReportStore implements ReportStore {
  private readonly m = new Map<string, Report>();
  save(r: Report): void {
    this.m.set(r.id, r);
  }
  get(id: string): Report | undefined {
    return this.m.get(id);
  }
  list(): Report[] {
    return [...this.m.values()];
  }
}
