import { gatherFactsV2, type AccountFactsV2 } from "@athera/agents";
import { AccountId } from "@athera/policy";
import { DEFAULT_MAINNET_RPCS, NearRpc } from "@athera/settlement";
import { payTokens, rateLimited } from "../../../lib/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cache = new Map<string, { at: number; value: unknown }>();

/**
 * GET ?account=… — a free, AI-free preview from public chain data: who controls the account and
 * what it holds. The paid report adds the written analysis. Rate-limited and cached 5 minutes.
 */
export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account")?.trim().toLowerCase() ?? "";
  if (!AccountId.safeParse(account).success) return Response.json({ error: "That is not a valid NEAR account ID." }, { status: 400 });
  const hit = cache.get(account);
  if (hit && Date.now() - hit.at < 300_000) return Response.json(hit.value);
  if (rateLimited(req, 30)) return Response.json({ error: "Too many previews from this address. Try again later." }, { status: 429 });
  let f: AccountFactsV2;
  try {
    f = await gatherFactsV2(new NearRpc(DEFAULT_MAINNET_RPCS), "intents.near", account, await payTokens());
  } catch {
    return Response.json({ error: `${account} could not be read. Check that it exists on NEAR mainnet.` }, { status: 404 });
  }
  const value = {
    account,
    total_usd: f.total_usd,
    largest_asset_pct: f.largest_asset_pct,
    holdings: f.tokens.filter((t) => !t.spam_like).length + f.intents.length + f.staked.length + 1,
    spam_tokens: f.tokens.filter((t) => t.spam_like).length,
    full_access_keys: f.keys.full_access,
    dao: f.dao
      ? { approvals_needed: f.dao.approvals_needed, approvers: f.dao.transfer_approvers.length, threshold: f.dao.threshold, proposals_90d: f.dao.proposals_90d, transfers: f.dao.recent_transfers.length }
      : null,
    missing: f.missing,
  };
  cache.set(account, { at: Date.now(), value });
  return Response.json(value);
}
