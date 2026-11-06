import { notFound } from "next/navigation";
import { Card, CardContent } from "../../../components/ui/card";
import { PageHeader } from "../../../components/ui/page-header";
import { orders, publicOrder } from "../../../lib/orders";
import { OrderStatus } from "./OrderStatus";

export const dynamic = "force-dynamic";
export const metadata = { title: "Order" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = orders.get(id);
  if (!o) notFound();
  const p = publicOrder(o);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        eyebrow={
          <span>
            Order <span className="data">{p.id}</span>
          </span>
        }
        title={`Treasury report on ${p.subject}`}
        description={`$${p.price_usd}, paid through NEAR Intents 1Click. Keep this page open, or bookmark it: it updates by itself and links the report when it is ready.`}
      />
      <Card>
        <CardContent>
          <OrderStatus initial={p} />
        </CardContent>
      </Card>
    </div>
  );
}
