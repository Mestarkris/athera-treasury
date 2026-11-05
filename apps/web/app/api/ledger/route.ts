import type { NextRequest } from "next/server";
import { currentPolicy, readLedger } from "../../../lib/ledger";

export const dynamic = "force-dynamic";

/**
 * GET /api/ledger?type=&agent=&result=&run=&limit=
 * Newest first. Includes the hash-chain check so a reader can see the file was not rewritten.
 */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const { entries, chain } = readLedger();
  const match = (key: "type" | "agent" | "result" | "run_id", param: string) => {
    const v = q.get(param);
    return (e: (typeof entries)[number]) => !v || e[key] === v;
  };
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 200) || 200, 1), 1000);
  const filtered = entries
    .filter(match("type", "type"))
    .filter(match("agent", "agent"))
    .filter(match("result", "result"))
    .filter(match("run_id", "run"))
    .reverse();
  return Response.json(
    {
      policy: currentPolicy(),
      chain,
      total: entries.length,
      count: Math.min(filtered.length, limit),
      entries: filtered.slice(0, limit),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
