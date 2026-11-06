import Link from "next/link";
import { fmt, parseUnits, type PolicyConfig } from "@athera/policy";
import { BoundaryLines } from "./BoundaryLines";
import { RunButton } from "./RunButton";
import styles from "./hero.module.css";

/** Ticker chips straight from config.yaml (never hard-coded), plus the live kill-switch state. */
function ruleChips(cfg: Readonly<PolicyConfig>, halted: boolean): { label: string; value: string }[] {
  const sym = (id: string) => cfg.assets.find((a) => a.id === id)?.symbol ?? id;
  const amt = (id: string, v: string) => {
    const d = cfg.assets.find((a) => a.id === id)?.decimals ?? 0;
    return fmt(cfg, id, parseUnits(v, d));
  };
  const out: { label: string; value: string }[] = [];
  for (const [id, l] of Object.entries(cfg.limits.capital_movement)) {
    out.push({ label: "Per-tx limit", value: amt(id, l.per_tx) });
    out.push({ label: "Daily cap", value: amt(id, l.per_day) });
  }
  out.push({ label: "Approved", value: cfg.approved.assets.map(sym).join(", ") });
  out.push({ label: "Max drawdown", value: `${cfg.risk.max_drawdown_pct}%` });
  for (const [id, v] of Object.entries(cfg.risk.min_reserve)) out.push({ label: "Reserve", value: amt(id, v) });
  out.push({ label: "Fee", value: `${cfg.fees.fee_bps} bps` });
  out.push({ label: "Revenue split", value: cfg.revenue_split.map((r) => r.pct).join("/") });
  out.push({ label: "AI spend", value: `$${cfg.limits.inference_spend_per_day_usd}/day` });
  if (cfg.inference) out.push({ label: "Per AI call", value: `$${cfg.inference.max_call_usd} max` });
  if (cfg.sales) out.push({ label: "Report price", value: `$${cfg.sales.min_price_usd}–$${cfg.sales.max_price_usd}` });
  out.push({ label: "Kill switch", value: halted ? "engaged" : "armed" });
  return out;
}

export function Hero({ cfg, policy, halted, network }: { cfg: Readonly<PolicyConfig>; policy: { version: number; hash: string }; halted: boolean; network: string }) {
  const chips = ruleChips(cfg, halted);
  const row = (dupe: boolean) =>
    chips.map((c, i) => (
      <span key={`${dupe}-${i}`} className={`${styles.chip} ${dupe ? styles.dupe : ""}`} aria-hidden={dupe || undefined}>
        {c.label} · <b>{c.value}</b>
      </span>
    ));
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <BoundaryLines />
      <div
        className={styles.ticker}
        tabIndex={0}
        role="region"
        aria-label={`Policy v${policy.version} rules from config.yaml (hover or focus to pause)`}
      >
        <div className={styles.track}>
          {row(false)}
          {row(true)}
        </div>
      </div>
      <h1 id="hero-title" className={styles.title}>
        Autonomous treasury that moves only inside <em>policy</em>.
      </h1>
      <p className={styles.subtitle}>
        Humans set the rules once. Agents act inside them. Every value movement settles through NEAR Intents and lands on a public ledger you can check yourself.
      </p>
      <div className={styles.ctas}>
        <Link href="/ledger" className={styles.primary}>
          View the ledger
        </Link>
        <RunButton network={network} />
      </div>
      <div className={styles.fade} aria-hidden="true" />
    </section>
  );
}
