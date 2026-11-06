import { OrderError, createOrder } from "@athera/agents";
import { loadPolicy } from "../../../lib/ledger";
import { accountExists, oneclick, orderState, orders, publicOrder, rateLimited } from "../../../lib/orders";
import { killSwitchState } from "../../../lib/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST { subject, originAsset, refundTo } creates an order: the price is checked by the policy
 * engine (pricing_rule) and 1Click returns a deposit address on the paying chain. Nothing is
 * signed and no key is loaded; the customer pays 1Click directly.
 */
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many orders from this address. Try again in an hour." }, { status: 429 });
  const ks = await killSwitchState();
  if (ks.engaged || ks.configFlag) return Response.json({ error: "Athera is halted, so it is not taking orders right now." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  try {
    const { order } = await createOrder(
      { policy: await loadPolicy(), oneclick, orders, state: (await orderState()), accountExists },
      { subject: str("subject"), originAsset: str("originAsset"), refundTo: str("refundTo") },
    );
    return Response.json({ order: publicOrder(order) }, { status: 201 });
  } catch (e) {
    if (e instanceof OrderError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: `Could not create the order: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
