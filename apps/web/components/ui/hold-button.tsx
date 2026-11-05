"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * Press-and-hold confirmation (pointer, or hold Enter/Space). The action fires from a timer the
 * moment the hold completes; it never waits on the fill animation. Releasing early cancels.
 */
export function HoldButton({
  children,
  holdingLabel,
  onConfirm,
  durationMs = 1200,
  disabled,
  hint,
  className,
}: {
  children: ReactNode;
  holdingLabel: ReactNode;
  onConfirm: () => void;
  durationMs?: number;
  disabled?: boolean;
  hint: string;
  className?: string;
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
  const label = holding ? holdingLabel : children;
  // Fill: clip-path only. Slow and linear while deciding; snaps back in 200ms on release.
  const fill: CSSProperties = {
    clipPath: holding ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
    transition: holding ? `clip-path ${durationMs}ms linear` : "clip-path 200ms var(--ease-out)",
  };

  return (
    <>
      <button
        type="button"
        data-holding={holding}
        disabled={disabled}
        aria-describedby={hintId}
        className={cn(
          "border-destructive/50 text-destructive relative inline-flex h-9 items-center justify-center overflow-hidden rounded-md border px-4 text-sm font-medium shadow-xs transition-[transform,background-color] duration-150 select-none touch-none pointer-coarse:h-11",
          "hover:bg-destructive/10 focus-visible:ring-destructive/30 outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 data-[holding=true]:scale-[0.97]",
          className,
        )}
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
        <span className="relative whitespace-nowrap">{label}</span>
        {/* Inverted copy of the label inside the fill; both are clipped together. */}
        <span aria-hidden="true" className="bg-destructive dark:text-background absolute inset-0 flex items-center justify-center whitespace-nowrap text-white" style={fill}>
          {label}
        </span>
      </button>
      <span id={hintId} className="visually-hidden">
        {hint}
      </span>
    </>
  );
}
