import { liveStatus, orders, spawnRun } from "../../../../../lib/orders";
import { killSwitchState, readRunLock } from "../../../../../lib/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const lastStart = new Map<string, number>();

/**
 * Start fulfilment of a paid order in the key-holding run process. Anyone may ask, but it only
 * starts when 1Click itself reports the payment as SUCCESS, the kill switch is off and no other
 * run holds the ledger. The run re-checks all of this before writing anything.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = orders.get(id);
  if (!o) return Response.json({ error: "No such order." }, { status: 404 });
  if (o.status === "fulfilled") return Response.json({ status: "fulfilled", reportId: o.report_id }, { status: 200 });
  const ks = killSwitchState();
  if (ks.engaged || ks.configFlag) return Response.json({ error: "Athera is halted; your payment is safe and the report will be written once it resumes." }, { status: 503 });
  const st = await liveStatus(o);
  if (st?.status !== "SUCCESS") return Response.json({ error: `Payment is not complete yet (${st?.status ?? "status unavailable"}).` }, { status: 409 });
  // At most one start per order every 20s, however often it is asked.
  const last = lastStart.get(o.id) ?? 0;
  if (Date.now() - last < 20_000) return Response.json({ error: "Fulfilment was started moments ago.", retry: true }, { status: 409 });
  const active = readRunLock();
  if (active) return Response.json({ error: "Another run is writing the ledger; trying again shortly.", retry: true }, { status: 409 });
  lastStart.set(o.id, Date.now());
  const runId = spawnRun(["--mode=fulfil", `--order=${o.id}`]);
  return Response.json({ runId }, { status: 202 });
}
