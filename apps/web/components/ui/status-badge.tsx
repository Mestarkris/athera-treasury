import { Badge, Dot } from "./badge";

export type StatusKind = "pass" | "block" | "pending" | "confirmed" | "failed" | "halted" | "info" | "stub";

const KINDS: Record<StatusKind, { variant: "success" | "warning" | "danger" | "outline" | "stub"; tone?: "pass" | "block" | "pending" | "idle"; label: string }> = {
  pass: { variant: "success", tone: "pass", label: "Passed" },
  confirmed: { variant: "success", tone: "pass", label: "Settled" },
  block: { variant: "danger", tone: "block", label: "Blocked" },
  failed: { variant: "danger", tone: "block", label: "Failed" },
  halted: { variant: "danger", tone: "block", label: "Halted" },
  pending: { variant: "warning", tone: "pending", label: "Pending" },
  info: { variant: "outline", tone: "idle", label: "Recorded" },
  stub: { variant: "stub", label: "STUB" },
};

/** Status = coloured dot + word, so meaning never relies on colour alone. */
export function StatusBadge({ kind, label }: { kind: StatusKind; label?: string | undefined; resolvedBy?: string | undefined }) {
  const k = KINDS[kind];
  return (
    <Badge variant={k.variant}>
      {k.tone ? <Dot tone={k.tone} /> : null}
      {label ?? k.label}
    </Badge>
  );
}
