// Hosted store for the public site. The key-holding agent runs on the operator's machine and
// publishes what the site shows (ledger, reports, policy, status) into a small Redis database;
// the site writes only new orders and halt requests into it. No signing key ever reaches it.
//
// Talks to Upstash Redis over its REST API with plain fetch (no SDK), so it works from Vercel
// functions and from the local worker alike. Credentials: KV_REST_API_URL + KV_REST_API_TOKEN
// (the names the Vercel Marketplace integration sets) or UPSTASH_REDIS_REST_URL/_TOKEN.

export interface StoreEnv {
  url: string;
  token: string;
}

export function storeEnv(env: Record<string, string | undefined> = process.env): StoreEnv | null {
  const url = env["KV_REST_API_URL"] ?? env["UPSTASH_REDIS_REST_URL"];
  const token = env["KV_REST_API_TOKEN"] ?? env["UPSTASH_REDIS_REST_TOKEN"];
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

type Arg = string | number;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class RedisRest {
  constructor(
    private readonly env: StoreEnv,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
  ) {}

  async cmd<T = unknown>(...args: Arg[]): Promise<T> {
    const res = await this.fetchImpl(this.env.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.env.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`store ${String(args[0])} failed: ${body.error ?? `HTTP ${res.status}`}`);
    return body.result as T;
  }

  async pipeline(cmds: Arg[][]): Promise<unknown[]> {
    if (cmds.length === 0) return [];
    const res = await this.fetchImpl(`${this.env.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.env.token}`, "content-type": "application/json" },
      body: JSON.stringify(cmds),
    });
    const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string }[] | null;
    if (!res.ok || !Array.isArray(body)) throw new Error(`store pipeline failed: HTTP ${res.status}`);
    const bad = body.find((r) => r.error);
    if (bad) throw new Error(`store pipeline failed: ${bad.error}`);
    return body.map((r) => r.result);
  }
}

/** Every key lives under this prefix so one database can be shared safely. */
export const K = {
  ledger: "athera:ledger", // list of JSON ledger entries, in seq order
  reports: "athera:reports", // hash report id → JSON
  orders: "athera:orders", // hash order id → JSON
  config: "athera:config", // config.yaml source the agent runs under
  policyHistory: "athera:policy_history", // JSON PolicyCommit[] (git is not available on the host)
  halt: "athera:halt", // JSON {reason, since} while the kill switch is engaged
  agent: "athera:agent", // JSON AgentMeta, refreshed every worker tick
} as const;

export interface HaltState {
  reason: string;
  since: string;
}

/** What the worker tells the site about itself. */
export interface AgentMeta {
  /** Last time the worker checked in. The site says "offline" when this is old. */
  seen_at: string;
  ai_key: boolean;
  policy_dirty: boolean;
  run: { runId: string; since: string } | null;
  /** Seconds between worker ticks, so the site can say how soon a paid order is picked up. */
  interval_s: number;
}

const parse = <T>(s: unknown): T | null => {
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

/** Typed access used by both the site and the worker. */
export class AtheraStore {
  constructor(readonly redis: RedisRest) {}

  static fromEnv(env?: Record<string, string | undefined>): AtheraStore | null {
    const e = storeEnv(env);
    return e ? new AtheraStore(new RedisRest(e)) : null;
  }

  // ledger
  ledgerLength = () => this.redis.cmd<number>("LLEN", K.ledger);
  async ledgerFrom<T>(start: number): Promise<T[]> {
    const rows = await this.redis.cmd<string[]>("LRANGE", K.ledger, start, -1);
    return rows.map((r) => JSON.parse(r) as T);
  }

  // documents kept in hashes
  async hget<T>(key: string, id: string): Promise<T | null> {
    return parse<T>(await this.redis.cmd("HGET", key, id));
  }
  async hvalues<T>(key: string): Promise<T[]> {
    const rows = await this.redis.cmd<string[]>("HVALS", key);
    return rows.map((r) => JSON.parse(r) as T);
  }
  hkeys = (key: string) => this.redis.cmd<string[]>("HKEYS", key);
  async hset(key: string, id: string, value: unknown): Promise<void> {
    await this.redis.cmd("HSET", key, id, JSON.stringify(value));
  }

  async getJson<T>(key: string): Promise<T | null> {
    return parse<T>(await this.redis.cmd("GET", key));
  }
  getText = (key: string) => this.redis.cmd<string | null>("GET", key);

  halt = () => this.getJson<HaltState>(K.halt);
  async engageHalt(reason: string, since = new Date().toISOString()): Promise<HaltState> {
    const h = { reason, since };
    // NX: an earlier halt keeps its reason and time.
    await this.redis.cmd("SET", K.halt, JSON.stringify(h), "NX");
    return (await this.halt()) ?? h;
  }
  async releaseHalt(): Promise<void> {
    await this.redis.cmd("DEL", K.halt);
  }

  agent = () => this.getJson<AgentMeta>(K.agent);
}
export * from "./policy-history.ts";
