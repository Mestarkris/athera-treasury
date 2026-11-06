import { payTokens } from "../../../lib/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Tokens a customer can pay with (1Click's list, with prices). */
export async function GET() {
  try {
    const tokens = await payTokens();
    return Response.json({ tokens: tokens.map((t) => ({ assetId: t.assetId, symbol: t.symbol, chain: t.blockchain, price: t.price })) });
  } catch {
    return Response.json({ error: "1Click token list is unavailable." }, { status: 502 });
  }
}
