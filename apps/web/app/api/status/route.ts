import { getStatus } from "../../../lib/status";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getStatus(), { headers: { "cache-control": "no-store" } });
}
