import { liveStatus, orders, publicOrder } from "../../../../lib/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The order plus 1Click's live status for its deposit address. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = orders.get(id);
  if (!o) return Response.json({ error: "No such order." }, { status: 404 });
  const status = o.status === "fulfilled" || o.status === "refunded" ? null : await liveStatus(o);
  return Response.json({ order: publicOrder(o), payment: status ? { status: status.status, nearTxHashes: status.nearTxHashes } : null });
}
