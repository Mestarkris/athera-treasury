"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Sheet.module.css";

/**
 * Bottom sheet on narrow screens, right-hand panel on wide ones.
 *
 * Deliberately NON-modal (no showModal / no inert page): the kill switch must stay reachable
 * while a sheet is open (brief: "reachable everywhere"). Focus moves into the sheet on open and
 * back to the opener on close; Escape and the scrim close it. Drag the handle down to dismiss:
 * past 30% of its height, or a quick flick (velocity > 0.11 px/ms), closes; otherwise it springs back.
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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return finishClose();
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
    <div className={styles.root}>
      <div className={styles.scrim} data-closing={closing} onClick={requestClose} aria-hidden="true" />
      <div
        ref={panel}
        className={styles.panel}
        data-closing={closing}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        onTransitionEnd={(e) => {
          if (closing && e.target === e.currentTarget && e.propertyName === "transform") finishClose();
        }}
      >
        <div
          className={styles.grip}
          onPointerDown={(e) => {
            if (drag.current) return; // ignore additional touch points
            if ((e.target as Element).closest("button")) return; // let Close be a plain click
            if (window.matchMedia("(min-width: 1000px)").matches) return; // side panel: no drag
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
          <span className={styles.handle} aria-hidden="true" />
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={requestClose}>
            Close
          </button>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
