import { FileKillSwitch } from "@athera/policy";
import { HALT_PATH, store } from "../../../lib/ledger";
import { checkOperator } from "../../../lib/operator";
import { killSwitchState } from "../../../lib/status";

export const dynamic = "force-dynamic";

/**
 * POST engages the operator halt immediately (writes data/HALT, or the hosted store; every running loop stops at its
 * next stage check). Releasing is deliberately NOT exposed on the web: run `pnpm halt --release`
 * on the server, so a halt can't be undone by whoever holds a browser tab.
 */
export async function POST(req: Request) {
  const denied = checkOperator(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 200) : "operator halt from the web console";
  // Hosted: the worker copies the halt to the agent's machine on its next tick (and every run
  // re-checks the local switch before each stage), so nothing new starts once this is set.
  if (store) await store.engageHalt(reason);
  else new FileKillSwitch(HALT_PATH).engage(reason);
  return Response.json((await killSwitchState()));
}

export function DELETE() {
  return Response.json({ error: "Release is not available from the web. On the server: pnpm halt --release" }, { status: 405 });
}
