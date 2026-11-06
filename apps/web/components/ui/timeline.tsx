import { Check, Minus, OctagonX, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type StageStatus = "waiting" | "active" | "done" | "blocked" | "halted" | "skipped";

export interface Stage {
  key: string;
  title: string;
  status: StageStatus;
  /** IDs, hashes, links: only from real backend events. */
  detail?: ReactNode;
  at?: string;
}

const ICON = { waiting: null, active: null, done: Check, blocked: X, halted: OctagonX, skipped: Minus } as const;
const WORD: Record<StageStatus, string> = { waiting: "Waiting", active: "In progress", done: "Done", blocked: "Blocked", halted: "Halted", skipped: "Not reached" };
const MARKER: Record<StageStatus, string> = {
  waiting: "border-[1.5px] border-muted-foreground/70 text-muted-foreground",
  active: "border-0 bg-pending-dot text-black animate-[breathe_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
  done: "border-0 bg-pass-dot text-black",
  blocked: "border-0 bg-block-dot text-black",
  halted: "border-0 bg-block-dot text-black",
  skipped: "border-[1.5px] border-dashed border-muted-foreground/50 text-muted-foreground",
};

/**
 * Vertical stage timeline. A pure function of `stages`: it animates only when a stage's status
 * changes because a real event arrived, and only when `live` (history renders still).
 */
export function Timeline({ stages, label, announce, live = false }: { stages: Stage[]; label: string; announce?: string; live?: boolean }) {
  return (
    <div>
      <ol aria-label={label} className="m-0 list-none p-0">
        {stages.map((s, i) => {
          const next = stages[i + 1];
          const connected = next !== undefined && next.status !== "waiting" && next.status !== "skipped";
          const Icon = ICON[s.status];
          const muted = s.status === "waiting" || s.status === "skipped";
          return (
            <li key={s.key} className="relative grid grid-cols-[24px_1fr] gap-x-3 pb-6 last:pb-0">
              <span className={cn("relative z-[1] mt-0.5 flex size-6 items-center justify-center rounded-full bg-background", MARKER[s.status])} aria-hidden="true">
                {Icon ? <Icon strokeWidth={3} className={cn("size-3", live && "animate-in fade-in zoom-in-75 duration-200 motion-reduce:zoom-in-100")} /> : null}
              </span>
              {next ? (
                <span aria-hidden="true" className="bg-border absolute top-[26px] bottom-0 left-[11.5px] w-px">
                  <span
                    className="bg-foreground/50 absolute inset-0 origin-top"
                    style={{ transform: `scaleY(${connected ? 1 : 0})`, transition: live ? "transform var(--dur-stage) var(--ease-in-out)" : "none" }}
                  />
                </span>
              ) : null}
              <div
                className={cn(
                  "min-w-0 pt-1",
                  s.status === "blocked" && "border-destructive border-l-2 pl-3",
                  s.status === "blocked" && live && "animate-in slide-in-from-left-1 duration-150 motion-reduce:slide-in-from-left-0",
                )}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                  <span className="min-w-0">
                    <span className={cn("font-medium", muted && "text-muted-foreground font-normal")}>{s.title}</span>
                    <span className={cn("text-muted-foreground ml-2 text-xs", (s.status === "blocked" || s.status === "halted") && "text-destructive")}>{WORD[s.status]}</span>
                  </span>
                  {s.at ? <span className="num text-muted-foreground text-xs whitespace-nowrap">{s.at}</span> : null}
                </div>
                {s.detail ? (
                  <div className={cn("text-muted-foreground mt-1 text-xs [overflow-wrap:anywhere]", live && "animate-in fade-in duration-150")}>{s.detail}</div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {announce ?? ""}
      </p>
    </div>
  );
}
