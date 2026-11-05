"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * shadcn-style sheet: bottom sheet below 1024px, right-hand panel above.
 *
 * Deliberately NON-modal (not Radix Dialog's modal mode): the kill switch must stay reachable
 * while a sheet is open. Focus moves in on open and back to the opener on close; Escape, the
 * close button and the overlay close it. On phones, drag the handle down to dismiss: past 30% of
 * its height, or a flick faster than 0.11 px/ms; otherwise it springs back.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const drag = useRef<{ y0: number; t0: number; dy: number; id: number } | null>(null);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  const finishClose = useCallback(() => {
    setClosing(false);
    onClose();
    if (opener.current instanceof HTMLElement) opener.current.focus();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return finishClose();
    setClosing(true);
  }, [finishClose]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  if (!mounted || !open) return null;

  const setY = (px: number, animate: boolean) => {
    const el = panel.current;
    if (!el) return;
    el.style.transition = animate ? "transform var(--dur-enter) var(--ease-drawer)" : "none";
    el.style.transform = `translate3d(0, ${px}px, 0)`;
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: "var(--z-sheet)" }}>
      <div
        aria-hidden="true"
        onClick={requestClose}
        data-closing={closing}
        className="pointer-events-auto absolute inset-0 bg-black/50 opacity-100 transition-opacity duration-150 starting:opacity-0 data-[closing=true]:opacity-0"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-closing={closing}
        onTransitionEnd={(e) => {
          if (closing && e.target === e.currentTarget && (e.propertyName === "transform" || e.propertyName === "translate")) finishClose();
        }}
        className={[
          "bg-background pointer-events-auto absolute inset-x-0 flex flex-col border-t shadow-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          // phones: bottom sheet sitting above the kill-switch bar
          "bottom-[calc(var(--bar-h)+env(safe-area-inset-bottom,0px))] max-h-[calc(88dvh-var(--bar-h))] rounded-t-xl",
          "translate-y-0 transition-transform duration-[var(--dur-enter)] ease-[var(--ease-drawer)] starting:translate-y-full",
          "data-[closing=true]:!translate-y-full data-[closing=true]:!duration-[var(--dur-exit)]",
          // desktop: right-hand panel
          "lg:inset-y-0 lg:right-0 lg:left-auto lg:bottom-0 lg:max-h-none lg:w-[min(560px,50vw)] lg:rounded-none lg:border-t-0 lg:border-l",
          "lg:starting:translate-x-full lg:starting:translate-y-0 lg:data-[closing=true]:!translate-x-full lg:data-[closing=true]:!translate-y-0",
          "motion-reduce:transition-none",
        ].join(" ")}
      >
        <div
          className="grid cursor-grab touch-none grid-cols-[1fr_auto] items-center gap-2 border-b px-4 pt-2 pb-3 select-none lg:cursor-default lg:pt-4"
          onPointerDown={(e) => {
            if (drag.current) return; // ignore additional touch points
            if ((e.target as Element).closest("button")) return; // Close stays a plain click
            if (window.matchMedia("(min-width: 1024px)").matches) return; // side panel: no drag
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y0: e.clientY, t0: performance.now(), dy: 0, id: e.pointerId };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            const raw = e.clientY - d.y0;
            // Downward follows the finger; upward meets increasing friction instead of a wall.
            d.dy = raw >= 0 ? raw : -Math.sqrt(-raw) * 2;
            setY(d.dy, false);
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (!d || d.id !== e.pointerId) return;
            const h = panel.current?.offsetHeight ?? 1;
            const velocity = d.dy / Math.max(performance.now() - d.t0, 1);
            if (d.dy > h * 0.3 || velocity > 0.11) {
              setY(h, true);
              setClosing(true);
            } else {
              setY(0, true);
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
            setY(0, true);
          }}
        >
          <span aria-hidden="true" className="bg-muted-foreground/30 col-span-2 mx-auto mb-1 h-1 w-9 rounded-full lg:hidden" />
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-9 items-center justify-center rounded-md pointer-coarse:size-11"
            aria-label="Close"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 pt-4 pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
