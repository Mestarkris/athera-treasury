import { currentPolicy, howToVerify, readLedger } from "../../../../lib/ledger";

export const dynamic = "force-dynamic";

/** GET /api/ledger/:id — one entry, its causal neighbours, and how to verify it without our logs. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { entries, chain } = readLedger();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return Response.json({ error: `no ledger entry ${id}` }, { status: 404 });
  const byId = new Map(entries.map((e) => [e.id, e]));
  const policy = currentPolicy();
  return Response.json(
    {
      entry,
      chain,
      policyIsCurrent: entry.policy.hash === policy.hash,
      upstream: (entry.upstream ?? []).map((u) => byId.get(u)).filter((e) => e !== undefined),
      downstream: entries.filter((e) => e.upstream?.includes(id)),
      sameRun: entries.filter((e) => e.run_id === entry.run_id).map((e) => ({ id: e.id, seq: e.seq, type: e.type, result: e.result })),
      verify: howToVerify(entry, policy.submitter),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
