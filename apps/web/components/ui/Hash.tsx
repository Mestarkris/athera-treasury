"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Hash.module.css";

/**
 * A hash or ID in the data face: head…tail visible, the full value in the copy and in the
 * accessible name. Optional explorer link. Copy confirms with "Copied" (announced politely).
 */
export function Hash({ value, head = 6, tail = 4, href, label }: { value: string; head?: number; tail?: number; href?: string | undefined; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Note: slice(-0) would return the whole string, so a zero tail is handled explicitly.
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${tail > 0 ? value.slice(-tail) : ""}` : value;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Insecure context or denied: select the text so the user can copy it by hand.
      const r = document.createRange();
      const el = document.getElementById(`hash-${value}`);
      if (el) {
        r.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(r);
      }
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  const text = (
    <span id={`hash-${value}`} className="data" title={value} translate="no">
      <span aria-hidden="true">{short}</span>
      <span className="visually-hidden">{value}</span>
    </span>
  );

  return (
    <span className={styles.hash}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label={`${short}, ${label} ${value}, on explorer (opens in new tab)`}>
          {text}
        </a>
      ) : (
        text
      )}
      <button type="button" className={styles.copy} onClick={copy} aria-label={`Copy ${label}`}>
        <span className={styles.copyLabel} data-copied={copied}>
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? `${label} copied` : ""}
      </span>
    </span>
  );
}
