// What the analyst knows about an account, from public data only. Balances are read from the chain
// itself (RPC); FastNEAR is used only to learn which tokens and staking pools to check, and
// NearBlocks only for recent activity. Every outside source is optional: if it fails, the fact is
// marked missing, never guessed.
import { formatUnits } from "@athera/policy";
import type { FetchLike } from "../ai/nearai.ts";
import type { ChainReader, Holding } from "./analyst.ts";
import type { OneClickToken } from "./oneclick.ts";

export interface TokenHolding {
  readonly contract: string;
  readonly symbol: string;
  readonly amount: string;
  readonly usd: number | null;
  /** Unpriced token whose name looks like a phishing airdrop (a link, "claim", "won", emoji…). */
  readonly spam_like: boolean;
}

const SPAMMY = /\.(com|io|net|org|xyz|app|fi)\b|claim|won|reward|airdrop|visit|bonus|free|[^\x20-\x7E]/i;

export interface DaoRole {
  readonly name: string;
  /** "everyone", "group" (listed members) or "member" (holders of a token weight). */
  readonly kind: string;
  readonly members: readonly string[];
  readonly can_approve_transfers: boolean;
  readonly can_propose_transfers: boolean;
}

export interface DaoTransfer {
  readonly id: number;
  readonly status: string;
  readonly receiver: string;
  readonly symbol: string;
  readonly amount: string;
  readonly usd: number | null;
  readonly date: string;
  /** Proposal description, truncated. Untrusted text written by whoever made the proposal. */
  readonly description: string;
}

export interface DaoFacts {
  readonly kind: "sputnik";
  readonly roles: readonly DaoRole[];
  /** People who can vote to approve a transfer, and how many votes one needs (RoleWeight policies). */
  readonly transfer_approvers: readonly string[];
  readonly approvals_needed: number | null;
  readonly threshold: string;
  readonly proposal_bond_near: string;
  readonly proposal_period_days: number;
  readonly proposal_count: number;
  /** Most recent proposals (newest first), any kind. */
  readonly recent_proposals: readonly { id: number; kind: string; status: string; date: string }[];
  /** Transfers among the recent proposals. */
  readonly recent_transfers: readonly DaoTransfer[];
  readonly approved_transfers_usd_90d: number;
  readonly proposals_90d: number;
}

export interface AccountFactsV2 {
  readonly version: 2;
  readonly account: string;
  readonly read_at: string;
  readonly block_height: number;
  readonly native_near: string;
  readonly native_usd: number | null;
  readonly storage_bytes: number;
  readonly is_contract: boolean;
  readonly keys: { readonly full_access: number; readonly function_call: number };
  readonly tokens: readonly TokenHolding[];
  readonly staked: readonly { readonly pool: string; readonly near: string; readonly usd: number | null }[];
  readonly intents: readonly Holding[];
  readonly total_usd: number;
  /** Share of total_usd in the largest single asset (0–100). */
  readonly largest_asset_pct: number | null;
  readonly dao: DaoFacts | null;
  readonly activity: { readonly last_tx_at: string; readonly txs_sampled: number } | null;
  /** Sources that could not be read; their facts are absent, not zero. */
  readonly missing: readonly string[];
}

const NEAR_DECIMALS = 24;
const round = (n: number) => Math.round(n * 100) / 100;
const nsDate = (ns: string | number) => new Date(Number(BigInt(String(ns)) / 1_000_000n)).toISOString().slice(0, 10);

interface Ctx {
  rpc: ChainReader;
  fetch: FetchLike;
  prices: Map<string, OneClickToken>;
  missing: string[];
}

async function json<T>(c: Ctx, url: string, label: string): Promise<T | null> {
  try {
    const res = await c.fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as T;
  } catch {
    c.missing.push(label);
    return null;
  }
}

async function ftMeta(c: Ctx, contract: string): Promise<{ symbol: string; decimals: number } | null> {
  const listed = c.prices.get(`nep141:${contract}`);
  if (listed) return { symbol: listed.symbol, decimals: listed.decimals };
  try {
    const m = await c.rpc.view<{ symbol: string; decimals: number }>(contract, "ft_metadata", {});
    return { symbol: String(m.symbol).slice(0, 16), decimals: Number(m.decimals) };
  } catch {
    return null;
  }
}

const usdOf = (c: Ctx, assetId: string, amount: string) => {
  const p = c.prices.get(assetId)?.price;
  return p ? round(Number(amount) * p) : null;
};

async function readTokens(c: Ctx, account: string, contracts: string[]): Promise<TokenHolding[]> {
  const out: TokenHolding[] = [];
  // Most-likely-valuable first: tokens 1Click prices, then the rest; at most 25 RPC reads.
  const ordered = [...contracts].sort((a, b) => Number(c.prices.has(`nep141:${b}`)) - Number(c.prices.has(`nep141:${a}`))).slice(0, 25);
  for (const contract of ordered) {
    try {
      const raw = BigInt(await c.rpc.view<string>(contract, "ft_balance_of", { account_id: account }));
      if (raw === 0n) continue;
      const meta = await ftMeta(c, contract);
      if (!meta) continue;
      const amount = formatUnits(raw, meta.decimals);
      const usd = usdOf(c, `nep141:${contract}`, amount);
      out.push({ contract, symbol: meta.symbol, amount, usd, spam_like: usd === null && SPAMMY.test(`${meta.symbol} ${contract}`) });
    } catch {
      /* not a fungible token, or unreadable: skip it */
    }
  }
  return out.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
}

async function readStaking(c: Ctx, account: string, pools: string[]) {
  const out: { pool: string; near: string; usd: number | null }[] = [];
  for (const pool of pools.slice(0, 10)) {
    try {
      const raw = BigInt(await c.rpc.view<string>(pool, "get_account_total_balance", { account_id: account }));
      if (raw === 0n) continue;
      const near = formatUnits(raw, NEAR_DECIMALS);
      out.push({ pool, near, usd: usdOf(c, "nep141:wrap.near", near) });
    } catch {
      c.missing.push(`staking pool ${pool}`);
    }
  }
  return out;
}

type SputnikKind = string | { Group?: string[]; Member?: unknown };
interface SputnikPolicy {
  roles: { name: string; kind: SputnikKind; permissions: string[]; vote_policy: Record<string, { weight_kind: string; quorum: string; threshold: unknown }> }[];
  default_vote_policy: { weight_kind: string; quorum: string; threshold: unknown };
  proposal_bond: string;
  proposal_period: string;
}
interface SputnikProposal {
  id: number;
  description: string;
  kind: string | Record<string, unknown>;
  status: string;
  submission_time: string;
}

const allows = (perms: string[], action: string) => perms.some((p) => p === "*:*" || p === `*:${action}` || p === `transfer:${action}` || p === "transfer:*");

async function readDao(c: Ctx, account: string): Promise<DaoFacts | null> {
  let policy: SputnikPolicy;
  try {
    policy = await c.rpc.view<SputnikPolicy>(account, "get_policy", {});
    if (!Array.isArray(policy?.roles)) return null;
  } catch {
    return null; // not a Sputnik DAO
  }
  const roles: DaoRole[] = policy.roles.map((r) => {
    const group = typeof r.kind === "object" && Array.isArray(r.kind.Group) ? r.kind.Group : [];
    return {
      name: r.name,
      kind: r.kind === "Everyone" ? "everyone" : typeof r.kind === "object" && r.kind.Group ? "group" : "member",
      members: group.slice(0, 50),
      can_approve_transfers: allows(r.permissions, "VoteApprove"),
      can_propose_transfers: allows(r.permissions, "AddProposal"),
    };
  });
  const approverRoles = policy.roles.filter((r) => allows(r.permissions, "VoteApprove"));
  const approvers = [...new Set(approverRoles.flatMap((r) => (typeof r.kind === "object" && Array.isArray(r.kind.Group) ? r.kind.Group : [])))];
  const vp = approverRoles[0]?.vote_policy?.["transfer"] ?? policy.default_vote_policy;
  let needed: number | null = null;
  let threshold = JSON.stringify(vp.threshold);
  if (vp.weight_kind === "RoleWeight" && Array.isArray(vp.threshold) && approvers.length) {
    const [num, den] = vp.threshold as [number, number];
    // Sputnik v2: votes needed = min(floor(total × num / den) + 1, total), at least the quorum.
    needed = Math.max(Number(vp.quorum || 0), Math.min(Math.floor((approvers.length * num) / den) + 1, approvers.length));
    threshold = `${num}/${den} of ${approvers.length}`;
  } else if (vp.weight_kind === "TokenWeight") {
    threshold = `token-weighted, ${threshold}`;
  }

  let last = 0;
  try {
    last = await c.rpc.view<number>(account, "get_last_proposal_id", {});
  } catch {
    c.missing.push("DAO proposal count");
  }
  let props: SputnikProposal[] = [];
  if (last > 0) {
    try {
      props = await c.rpc.view<SputnikProposal[]>(account, "get_proposals", { from_index: Math.max(0, last - 40), limit: 40 });
    } catch {
      c.missing.push("DAO proposals");
    }
  }
  props.sort((a, b) => b.id - a.id);
  // Sputnik leaves a proposal "InProgress" until someone acts on it, even after the voting window
  // closes; past the window it can no longer pass, so report it as expired.
  const periodMs = Number(BigInt(policy.proposal_period || "0") / 1_000_000n);
  for (const p of props) {
    if (p.status === "InProgress" && Number(BigInt(p.submission_time) / 1_000_000n) + periodMs < Date.now()) p.status = "Expired";
  }
  const since = Date.now() - 90 * 86_400_000;
  const transfers: DaoTransfer[] = [];
  let approvedUsd = 0;
  for (const p of props) {
    const t = typeof p.kind === "object" ? (p.kind["Transfer"] as { token_id: string; receiver_id: string; amount: string } | undefined) : undefined;
    if (!t) continue;
    const contract = t.token_id || "";
    const meta = contract ? await ftMeta(c, contract) : { symbol: "NEAR", decimals: NEAR_DECIMALS };
    const amount = meta ? formatUnits(BigInt(t.amount), meta.decimals) : t.amount;
    const usd = meta ? usdOf(c, contract ? `nep141:${contract}` : "nep141:wrap.near", amount) : null;
    const date = nsDate(p.submission_time);
    if (p.status === "Approved" && Date.parse(date) >= since) approvedUsd += usd ?? 0;
    transfers.push({ id: p.id, status: p.status, receiver: t.receiver_id, symbol: meta?.symbol ?? contract, amount, usd, date, description: p.description.replace(/\s+/g, " ").slice(0, 140) });
  }
  return {
    kind: "sputnik",
    roles,
    transfer_approvers: approvers,
    approvals_needed: needed,
    threshold,
    proposal_bond_near: formatUnits(BigInt(policy.proposal_bond || "0"), NEAR_DECIMALS),
    proposal_period_days: Math.round(Number(BigInt(policy.proposal_period || "0") / 1_000_000_000n) / 86_400),
    proposal_count: last,
    recent_proposals: props.slice(0, 12).map((p) => ({ id: p.id, kind: typeof p.kind === "string" ? p.kind : (Object.keys(p.kind)[0] ?? "?"), status: p.status, date: nsDate(p.submission_time) })),
    recent_transfers: transfers.slice(0, 15),
    approved_transfers_usd_90d: round(approvedUsd),
    proposals_90d: props.filter((p) => Date.parse(nsDate(p.submission_time)) >= since).length,
  };
}

/** Everything the report says about an account, from public data. */
export async function gatherFactsV2(
  rpc: ChainReader,
  verifier: string,
  account: string,
  tokens: readonly OneClickToken[],
  opts: { fetch?: FetchLike; fastnear?: string; nearblocks?: string } = {},
): Promise<AccountFactsV2> {
  const c: Ctx = { rpc, fetch: opts.fetch ?? ((u, i) => fetch(u, i)), prices: new Map(tokens.map((t) => [t.assetId, t])), missing: [] };
  const view = await rpc.call<{ amount: string; storage_usage: number; code_hash: string; block_height: number }>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: account,
  });
  const nativeNear = formatUnits(BigInt(view.amount), NEAR_DECIMALS);

  let keys = { full_access: 0, function_call: 0 };
  try {
    const list = await rpc.call<{ keys: { access_key: { permission: unknown } }[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: account });
    keys = {
      full_access: list.keys.filter((k) => k.access_key.permission === "FullAccess").length,
      function_call: list.keys.filter((k) => k.access_key.permission !== "FullAccess").length,
    };
  } catch {
    c.missing.push("access keys");
  }

  const index = await json<{ tokens?: { contract_id: string }[]; pools?: { pool_id: string }[] }>(c, `${opts.fastnear ?? "https://api.fastnear.com"}/v1/account/${account}/full`, "token and staking index (FastNEAR)");
  const ftList = await readTokens(c, account, (index?.tokens ?? []).map((t) => t.contract_id));
  const staked = await readStaking(c, account, (index?.pools ?? []).map((p) => p.pool_id));

  // Intents balances, as before.
  const intents: Holding[] = [];
  try {
    const owned = await rpc.view<{ token_id: string }[]>(verifier, "mt_tokens_for_owner", { account_id: account, limit: 50 });
    const ids = owned.map((t) => t.token_id);
    const bal = ids.length ? await rpc.view<string[]>(verifier, "mt_batch_balance_of", { account_id: account, token_ids: ids }) : [];
    ids.forEach((id, i) => {
      const raw = BigInt(bal[i] ?? "0");
      if (raw === 0n) return;
      const t = c.prices.get(id);
      const amount = t ? formatUnits(raw, t.decimals) : raw.toString();
      intents.push({ asset: id, symbol: t?.symbol ?? id, amount, usd: t ? round(Number(amount) * t.price) : null });
    });
  } catch {
    c.missing.push("NEAR Intents balances");
  }

  const dao = view.code_hash !== "11111111111111111111111111111111" ? await readDao(c, account) : null;

  const tx = await json<{ txns?: { block_timestamp: string }[] }>(c, `${opts.nearblocks ?? "https://api.nearblocks.io"}/v1/account/${account}/txns-only?per_page=25`, "recent transactions (NearBlocks)");
  const activity = tx?.txns?.length ? { last_tx_at: nsDate(tx.txns[0]!.block_timestamp), txs_sampled: tx.txns.length } : null;

  const nativeUsd = usdOf(c, "nep141:wrap.near", nativeNear);
  const parts = [nativeUsd ?? 0, ...ftList.map((t) => t.usd ?? 0), ...staked.map((s) => s.usd ?? 0), ...intents.map((h) => h.usd ?? 0)];
  const total = round(parts.reduce((a, b) => a + b, 0));
  // Largest single asset: NEAR (native + staked + wNEAR) counted together.
  const byAsset = new Map<string, number>();
  const add = (k: string, v: number | null) => byAsset.set(k, (byAsset.get(k) ?? 0) + (v ?? 0));
  add("NEAR", nativeUsd);
  staked.forEach((s) => add("NEAR", s.usd));
  ftList.forEach((t) => add(t.contract === "wrap.near" ? "NEAR" : t.symbol, t.usd));
  intents.forEach((h) => add(h.asset === "nep141:wrap.near" ? "NEAR" : h.symbol, h.usd));
  const largest = total > 0 ? Math.round((Math.max(...byAsset.values()) / total) * 100) : null;

  return {
    version: 2,
    account,
    read_at: new Date().toISOString(),
    block_height: view.block_height,
    native_near: nativeNear,
    native_usd: nativeUsd,
    storage_bytes: view.storage_usage,
    is_contract: view.code_hash !== "11111111111111111111111111111111",
    keys,
    tokens: ftList,
    staked,
    intents,
    total_usd: total,
    largest_asset_pct: largest,
    dao,
    activity,
    missing: c.missing,
  };
}
