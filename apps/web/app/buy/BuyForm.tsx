"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

type Token = { assetId: string; symbol: string; chain: string; price: number };

const selectClass =
  "border-input bg-background dark:bg-input/30 h-9 w-full rounded-md border px-3 text-base md:text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] pointer-coarse:h-11";

const CHAIN_NAMES: Record<string, string> = { near: "NEAR", eth: "Ethereum", arb: "Arbitrum", base: "Base", sol: "Solana", btc: "Bitcoin", bsc: "BNB Chain", pol: "Polygon", op: "Optimism", avax: "Avalanche", ton: "TON", tron: "Tron", sui: "Sui", aptos: "Aptos", doge: "Dogecoin", xrp: "XRP Ledger", zec: "Zcash", gnosis: "Gnosis", bera: "Berachain", stellar: "Stellar" };
const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();

type Preview = {
  account: string;
  total_usd: number;
  largest_asset_pct: number | null;
  holdings: number;
  spam_tokens: number;
  full_access_keys: number;
  dao: { approvals_needed: number | null; approvers: number; threshold: string; proposals_90d: number; transfers: number } | null;
  missing: string[];
};

/** A free summary of what the paid report will cover (public data, no AI). */
function PreviewLine({ p }: { p: Preview }) {
  const parts = [
    p.dao
      ? `Sputnik DAO: a transfer needs ${p.dao.approvals_needed !== null ? `${p.dao.approvals_needed} of ${p.dao.approvers}` : p.dao.threshold} approvals; ${p.dao.proposals_90d} proposals in 90 days`
      : p.full_access_keys
        ? `${p.full_access_keys} full-access key${p.full_access_keys > 1 ? "s" : ""} can move everything`
        : "no full-access key",
    `${p.holdings} priced holding${p.holdings === 1 ? "" : "s"} worth $${p.total_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}${p.largest_asset_pct !== null ? `, ${p.largest_asset_pct}% in one asset` : ""}`,
    p.spam_tokens ? `${p.spam_tokens} spam-like token${p.spam_tokens > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  return (
    <p>
      <span className="text-muted-foreground">Preview of {p.account}: </span>
      {parts.join(" · ")}. The report explains what this means and what limits to set.
    </p>
  );
}

export function BuyForm({ tokens, defaultAsset, price }: { tokens: Token[]; defaultAsset: string; price: string }) {
  const router = useRouter();
  const [asset, setAsset] = useState(defaultAsset);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chains = useMemo(() => [...new Set(tokens.map((t) => t.chain))].sort((a, b) => chainName(a).localeCompare(chainName(b))), [tokens]);
  const chosen = tokens.find((t) => t.assetId === asset);
  const [preview, setPreview] = useState<Preview | { error: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const lastChecked = useRef("");

  async function check(account: string) {
    const a = account.trim().toLowerCase();
    if (!a || a === lastChecked.current) return;
    lastChecked.current = a;
    setChecking(true);
    try {
      const res = await fetch(`/api/preview?account=${encodeURIComponent(a)}`);
      setPreview((await res.json().catch(() => ({ error: "Preview unavailable." }))) as Preview | { error: string });
    } finally {
      setChecking(false);
    }
  }

  async function submit(form: FormData) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: form.get("subject"), originAsset: asset, refundTo: form.get("refundTo") }),
      });
      const b = (await res.json().catch(() => ({}))) as { order?: { id: string }; error?: string };
      if (!res.ok || !b.order) {
        setError(b.error ?? `Could not create the order (HTTP ${res.status}).`);
        return;
      }
      router.push(`/orders/${b.order.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="grid max-w-xl gap-5">
      <div className="grid gap-2">
        <Label htmlFor="subject">NEAR account to review</Label>
        <Input
          id="subject"
          name="subject"
          required
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="your-dao.sputnik-dao.near"
          onBlur={(e) => void check(e.currentTarget.value)}
          aria-describedby="subject-preview"
        />
        <div id="subject-preview" aria-live="polite" className="text-sm">
          {checking ? (
            <p className="text-muted-foreground">Reading the account from the chain…</p>
          ) : preview && "error" in preview ? (
            <p className="text-destructive">{preview.error}</p>
          ) : preview ? (
            <PreviewLine p={preview} />
          ) : (
            <p className="text-muted-foreground">Any account on NEAR mainnet; DAOs get a governance review. Free preview when you leave this field; the report uses only public chain data.</p>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="asset">Pay with</Label>
        <select id="asset" value={asset} onChange={(e) => setAsset(e.target.value)} className={selectClass}>
          {chains.map((c) => (
            <optgroup key={c} label={chainName(c)}>
              {tokens
                .filter((t) => t.chain === c)
                .map((t) => (
                  <option key={t.assetId} value={t.assetId}>
                    {t.symbol} on {chainName(c)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="refundTo">Refund address{chosen ? ` on ${chainName(chosen.chain)}` : ""}</Label>
        <Input id="refundTo" name="refundTo" required autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={chosen?.chain === "near" ? "you.near" : "your address on that chain"} />
        <p className="text-muted-foreground text-sm">If the payment cannot be completed, 1Click returns it here.</p>
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Getting a quote…" : `Get a quote for ${price}`}
        </Button>
      </div>
    </form>
  );
}
