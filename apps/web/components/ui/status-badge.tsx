import { Check, Clock, OctagonX, X } from "lucide-react";
import { Badge } from "./badge";

export type StatusKind = "pass" | "block" | "pending" | "confirmed" | "failed" | "halted" | "info" | "stub";

const KINDS: Record<StatusKind, { variant: "success" | "warning" | "danger" | "outline"; Icon?: typeof Check; label: string }> = {
  pass: { variant: "success", Icon: Check, label: "Passed" },
  confirmed: { variant: "success", Icon: Check, label: "Confirmed" },
  block: { variant: "danger", Icon: X, label: "Blocked" },
  failed: { variant: "danger", Icon: X, label: "Failed" },
  halted: { variant: "danger", Icon: OctagonX, label: "Halted" },
  pending: { variant: "warning", Icon: Clock, label: "Pending" },
  info: { variant: "outline", label: "Recorded" },
  stub: { variant: "outline", label: "STUB" },
};

/** Status = icon + word + colour, so meaning never relies on colour alone. */
export function StatusBadge({ kind, label }: { kind: StatusKind; label?: string | undefined; resolvedBy?: string | undefined }) {
  const k = KINDS[kind];
  return (
    <Badge variant={k.variant} className={kind === "stub" ? "font-semibold tracking-wide" : undefined}>
      {k.Icon ? <k.Icon aria-hidden="true" /> : null}
      {label ?? k.label}
    </Badge>
  );
}
