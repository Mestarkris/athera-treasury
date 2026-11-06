import { Card, CardContent } from "../../components/ui/card";
import { PageHeader } from "../../components/ui/page-header";
import { loadPolicy } from "../../lib/ledger";
import { payTokens } from "../../lib/orders";
import { BuyForm } from "./BuyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Buy a report" };

export default async function BuyPage() {
  const cfg = (await loadPolicy()).config;
  const tokens = await payTokens().catch(() => []);
  const price = cfg.sales ? `$${cfg.sales.min_price_usd}` : "";
  const settle = cfg.sales?.settle_asset ?? "";
  const defaultAsset = tokens.find((t) => t.assetId === settle)?.assetId ?? tokens[0]?.assetId ?? "";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title={
          <>
            Know who can move your DAO’s <span className="serif-accent">money</span>.
          </>
        }
        description={`For members, delegates and contributors of NEAR DAOs. An AI-written review of any account from public chain data: who can approve spending and how many votes it takes, what has been paid out recently, how concentrated the holdings are, spam tokens to avoid, and the limits worth setting. ${price}, paid in almost any token on almost any chain through NEAR Intents 1Click (bridged payments can cost more when the bridge has a minimum; the quote shows the exact price). You send the payment yourself; Athera never touches your wallet.`}
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
