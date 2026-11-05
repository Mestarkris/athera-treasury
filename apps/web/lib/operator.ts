import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Operator controls (start a run, engage the kill switch) need ATHERA_OPERATOR_TOKEN, sent by
 * the client as the x-athera-operator header (never a cookie, so no CSRF surface). Without the
 * env var the deployment is read-only and every mutation is refused.
 */
export const operatorEnabled = () => Boolean(process.env["ATHERA_OPERATOR_TOKEN"]);

export function checkOperator(req: Request): Response | null {
  const expected = process.env["ATHERA_OPERATOR_TOKEN"];
  if (!expected) return Response.json({ error: "Read-only deployment: operator controls are disabled. On the server, use pnpm demo / pnpm halt." }, { status: 403 });
  const got = req.headers.get("x-athera-operator") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "Operator token missing or wrong. It is ATHERA_OPERATOR_TOKEN in apps/web/.env.local on the server; unlock again with that value." }, { status: 401 });
  return null;
}
