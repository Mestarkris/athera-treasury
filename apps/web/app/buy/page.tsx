import { Card, CardContent } from "../../components/ui/card";
import { PageHeader } from "../../components/ui/page-header";
import { loadPolicy } from "../../lib/ledger";
import { payTokens } from "../../lib/orders";
import { BuyForm } from "./BuyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Buy a report" };

export default async function BuyPage() {
  const cfg = loadPolicy().config;
  const tokens = await payTokens().catch(() => []);
  const price = cfg.sales ? `$${cfg.sales.min_price_usd}` : "";
  const settle = cfg.sales?.settle_asset ?? "";
  const defaultAsset = tokens.find((t) => t.assetId === settle)?.assetId ?? tokens[0]?.assetId ?? "";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Buy a treasury report"
        description={`An AI-written review of any NEAR account's treasury: what it holds, the risks and the policy limits worth setting. ${price} paid in almost any token on almost any chain through NEAR Intents 1Click; payments bridged from another chain cost more when the bridge has a minimum, and the quote shows the exact price. Athera never touches your wallet; you send the payment yourself.`}
      />
      <Card>
        <CardContent>
          {!cfg.sales ? (
            <p className="text-muted-foreground text-sm">Nothing is for sale under the current policy.</p>
          ) : tokens.length === 0 ? (
            <p className="text-muted-foreground text-sm">The 1Click token list is unavailable right now. Try again in a minute.</p>
          ) : (
            <BuyForm tokens={tokens.map((t) => ({ assetId: t.assetId, symbol: t.symbol, chain: t.blockchain, price: t.price }))} defaultAsset={defaultAsset} price={price} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
