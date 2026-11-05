import { StatusMark, type Mark } from "./StatusMark";
import styles from "./Badge.module.css";

export type BadgeTone = "pass" | "block" | "pending" | "neutral";
export type BadgeKind = "pass" | "block" | "pending" | "confirmed" | "failed" | "halted" | "info" | "stub";

const KINDS: Record<BadgeKind, { tone: BadgeTone; glyph?: Mark; label: string }> = {
  pass: { tone: "pass", glyph: "check", label: "Passed" },
  confirmed: { tone: "pass", glyph: "check", label: "Confirmed" },
  block: { tone: "block", glyph: "cross", label: "Blocked" },
  failed: { tone: "block", glyph: "cross", label: "Failed" },
  halted: { tone: "block", glyph: "square", label: "Halted" },
  pending: { tone: "pending", glyph: "clock", label: "Pending" },
  info: { tone: "neutral", label: "Recorded" },
  stub: { tone: "neutral", label: "STUB" },
};

/** Status word with a glyph, so meaning never relies on colour alone. */
export function Badge({ kind, label }: { kind: BadgeKind; label?: string | undefined; resolvedBy?: string | undefined }) {
  const k = KINDS[kind];
  return (
    <span className={`${styles.badge} ${styles[k.tone]} ${kind === "stub" ? styles.stub : ""}`}>
      {k.glyph ? <StatusMark mark={k.glyph} className={styles.glyph} /> : null}
      {label ?? k.label}
    </span>
  );
}
