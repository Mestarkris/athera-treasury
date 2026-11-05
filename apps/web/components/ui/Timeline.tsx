import type { ReactNode } from "react";
import { StatusMark, type Mark } from "./StatusMark";
import styles from "./Timeline.module.css";

export type StageStatus = "waiting" | "active" | "done" | "blocked" | "halted" | "skipped";

export interface Stage {
  key: string;
  title: string;
  status: StageStatus;
  /** IDs, hashes, links: only from real backend events. */
  detail?: ReactNode;
  at?: string;
}

const GLYPH: Record<StageStatus, Mark | null> = { waiting: null, active: "clock", done: "check", blocked: "cross", halted: "square", skipped: "dash" };
const WORD: Record<StageStatus, string> = { waiting: "Waiting", active: "In progress", done: "Done", blocked: "Blocked", halted: "Halted", skipped: "Not reached" };

/**
 * Vertical stage timeline. Purely a function of `stages`: it animates only when a stage's status
 * changes because a real event arrived. There are no timers here. The connector below a stage fills
 * (scaleY) once the next stage has started.
 */
export function Timeline({ stages, label, announce, live = false }: { stages: Stage[]; label: string; announce?: string; live?: boolean }) {
  return (
    <div>
      {/* live=false (history): render still. Motion is reserved for stages whose event just arrived. */}
      <ol className={styles.timeline} aria-label={label} data-live={live}>
        {stages.map((s, i) => {
          const next = stages[i + 1];
          const connected = next !== undefined && next.status !== "waiting" && next.status !== "skipped";
          return (
            <li key={s.key} className={styles.stage} data-status={s.status}>
              <span className={styles.marker} aria-hidden="true">
                {GLYPH[s.status] ? <StatusMark mark={GLYPH[s.status]!} className={styles.glyph} /> : null}
              </span>
              {next ? (
                <span className={styles.connector} aria-hidden="true">
                  <span className={styles.connectorFill} data-filled={connected} />
                </span>
              ) : null}
              <div className={styles.body}>
                <div className={styles.head}>
                  <span className={styles.name}>
                    <span className={styles.title}>{s.title}</span> <span className={styles.state}>{WORD[s.status]}</span>
                  </span>
                  {s.at ? <span className={`${styles.at} data`}>{s.at}</span> : null}
                </div>
                {s.detail ? <div className={styles.detail}>{s.detail}</div> : null}
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
