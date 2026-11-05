"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./HoldButton.module.css";

/**
 * Press-and-hold confirmation (pointer, or hold Enter/Space). The action fires from a timer the
 * moment the hold completes; it never waits on the fill animation. Releasing early cancels.
 */
export function HoldButton({
  children,
  holdingLabel,
  onConfirm,
  durationMs = 1200,
  tone = "danger",
  disabled,
  hint,
}: {
  children: ReactNode;
  holdingLabel: ReactNode;
  onConfirm: () => void;
  durationMs?: number;
  tone?: "danger" | "ink";
  disabled?: boolean;
  hint: string;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hintId = useId();

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  }, []);

  const start = useCallback(() => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      onConfirm();
    }, durationMs);
  }, [disabled, durationMs, onConfirm]);

  useEffect(() => cancel, [cancel]);

  return (
    <>
      <button
        type="button"
        className={`${styles.hold} ${styles[tone]}`}
        data-holding={holding}
        style={{ ["--hold" as string]: `${durationMs}ms` }}
        disabled={disabled}
        aria-describedby={hintId}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          start();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
            e.preventDefault();
            start();
          }
          if (e.key === "Escape") cancel();
        }}
        onKeyUp={(e) => {
          if (e.key === "Enter" || e.key === " ") cancel();
        }}
        onBlur={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className={styles.label}>{holding ? holdingLabel : children}</span>
        {/* Inverted copy of the label inside the fill; both are clipped together. */}
        <span className={styles.fill} aria-hidden="true">
          <span className={styles.labelInverse}>{holding ? holdingLabel : children}</span>
        </span>
      </button>
      <span id={hintId} className="visually-hidden">
        {hint}
      </span>
    </>
  );
}
