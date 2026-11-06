import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { newRunId } from "@athera/agents";
import { ROOT, store } from "../../../lib/ledger";
import { checkOperator } from "../../../lib/operator";
import { killSwitchState, readRunLock } from "../../../lib/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST { mode: "loop" | "invalid" | "sale" } starts scripts/demo/run.ts as a separate process. The web
 * server never loads signing keys: the child reads .env itself, and its ledger writes reach the
 * UI through /api/stream. Refused while halted or while another run holds the ledger lock.
 */
export async function POST(req: Request) {
  const denied = checkOperator(req);
  if (denied) return denied;
  if (store) return Response.json({ error: "The hosted site holds no keys and cannot start runs. Start them on the agent's machine: pnpm demo --mode=…" }, { status: 501 });
  const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
  const mode = body.mode === "invalid" ? "invalid" : body.mode === "loop" ? "loop" : body.mode === "sale" ? "sale" : null;
  if (!mode) return Response.json({ error: "mode must be loop, invalid or sale" }, { status: 400 });
  const ks = await killSwitchState();
  if (ks.engaged || ks.configFlag) return Response.json({ error: `Kill switch is engaged (${ks.reason ?? "config.yaml"}). Release it on the server first.` }, { status: 409 });
  const active = await readRunLock();
  if (active) return Response.json({ error: `Run ${active.runId} is still writing the ledger.` }, { status: 409 });

  const runId = newRunId();
  const logDir = resolve(ROOT, "data/runs");
  mkdirSync(logDir, { recursive: true });
  const out = openSync(resolve(logDir, `${runId}.log`), "a");
  const child = spawn(process.execPath, ["--import", "tsx", resolve(ROOT, "scripts/demo/run.ts"), `--mode=${mode}`, `--run-id=${runId}`], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, NODE_ENV: "production" },
  });
  child.unref();
  return Response.json({ runId, mode }, { status: 202 });
}
