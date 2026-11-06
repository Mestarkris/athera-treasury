"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";

type PublicOrder = {
  id: string;
  subject: string;
  price_usd: string;
  origin: { symbol: string; chain: string };
  deposit_address: string;
  amount_in_formatted: string;
  deadline: string;
  status: "awaiting_payment" | "paid" | "fulfilled" | "refunded" | "failed";
  report_id?: string;
};

const PAYMENT_TEXT: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your payment.",
  KNOWN_DEPOSIT_TX: "Payment seen on chain; waiting for confirmations.",
  INCOMPLETE_DEPOSIT: "Less than the quoted amount arrived. Send the rest, or 1Click refunds it after the deadline.",
  PROCESSING: "Payment received; 1Click is converting it to USDC.",
  SUCCESS: "Paid. Writing your report…",
  REFUNDED: "The payment was refunded to your refund address.",
  FAILED: "The swap failed. Any deposit is refunded by 1Click.",
};

export function OrderStatus({ initial }: { initial: PublicOrder }) {
  const [order, setOrder] = useState(initial);
  const [payment, setPayment] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const asked = useRef(0);

  useEffect(() => {
    if (order.status === "fulfilled" || order.status === "refunded") return;
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/api/orders/${order.id}`, { cache: "no-store" }).catch(() => null);
      const b = res?.ok ? ((await res.json()) as { order: PublicOrder; payment: { status: string } | null }) : null;
      if (stop || !b) return;
      setOrder(b.order);
      setPayment(b.payment?.status ?? null);
      // Paid but not yet fulfilled: ask the server to fulfil (at most every 15s).
      if (b.payment?.status === "SUCCESS" && b.order.status !== "fulfilled" && Date.now() - asked.current > 15_000) {
        asked.current = Date.now();
        const f = await fetch(`/api/orders/${order.id}/fulfil`, { method: "POST" }).catch(() => null);
        const fb = f ? ((await f.json().catch(() => ({}))) as { error?: string; note?: string }) : {};
        if (!stop) setNote(f && f.status >= 400 && f.status !== 409 ? (fb.error ?? null) : (fb.note ?? null));
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [order.id, order.status]);

  const expired = Date.parse(order.deadline) < Date.now() && order.status === "awaiting_payment" && (payment === null || payment === "PENDING_DEPOSIT");

  if (order.status === "fulfilled" && order.report_id) {
    return (
      <div className="grid gap-3" role="status">
        <p className="text-lg font-medium">Your report is ready.</p>
        <p>
          <Link href={`/reports/${order.report_id}`} className="font-medium underline underline-offset-4">
            Read the report on {order.subject}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {order.status === "awaiting_payment" && !expired ? (
        <div className="grid gap-2">
          <p>
            Send exactly{" "}
            <strong className="data">
              {order.amount_in_formatted} {order.origin.symbol}
            </strong>{" "}
            on <strong>{order.origin.chain.toUpperCase()}</strong> to:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="data bg-muted rounded px-2 py-1 text-sm [overflow-wrap:anywhere]">{order.deposit_address}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(order.deposit_address).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? "Copied" : "Copy address"}
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Pay by {new Date(order.deadline).toUTCString()}. The address belongs to 1Click (NEAR Intents); it converts your payment to {`$${order.price_usd}`} USDC for Athera. Sending a
            different token or amount may be refunded.
          </p>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {expired ? "This quote expired before a payment arrived. Start a new order." : payment ? PAYMENT_TEXT[payment] ?? payment : order.status === "paid" ? "Paid. Writing your report…" : "Checking payment status…"}
      </p>
      {note ? (
        <p className="text-destructive text-sm" role="alert">
          {note}
        </p>
      ) : null}
    </div>
  );
}
