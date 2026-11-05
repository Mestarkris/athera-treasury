"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

/**
 * A hash or ID in mono: head…tail visible, the full value in copy, title and accessible name.
 * Optional explorer link. Copy confirms with a check (announced politely).
 */
export function Hash({ value, head = 6, tail = 4, href, label, className }: { value: string; head?: number; tail?: number; href?: string | undefined; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // slice(-0) would return the whole string, so a zero tail is handled explicitly.
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${tail > 0 ? value.slice(-tail) : ""}` : value;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Insecure context or denied: select the text so it can be copied by hand.
      const el = document.getElementById(`hash-${value}`);
      if (el) {
        const r = document.createRange();
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
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline" aria-label={`${short}, ${label} ${value}, on explorer (opens in new tab)`}>
          {text}
        </a>
      ) : (
        text
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-6 items-center justify-center rounded-md transition-colors pointer-coarse:size-9 [&_svg]:size-3.5"
      >
        {copied ? <Check className="text-success" aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? `${label} copied` : ""}
      </span>
    </span>
  );
}
