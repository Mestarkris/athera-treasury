"use client";

import Link from "next/link";
import { ViewTransition } from "react";

export const OPEN_ENTRY_EVENT = "athera:open-entry";
const NARROW = "(max-width: 699px)";

/**
 * The event name in a ledger row. Wide screens: navigate to the entry, and the label morphs into
 * the detail page heading (shared element, `nav-forward`). Narrow screens: open the entry in a
 * bottom sheet instead (drag down to dismiss); the full page is one tap away inside it.
 */
export function EntryLink({ id, label }: { id: string; label: string }) {
  return (
    <Link
      href={`/ledger/${id}`}
      transitionTypes={["nav-forward"]}
      onClick={(ev) => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
        if (window.matchMedia(NARROW).matches) {
          ev.preventDefault();
          window.dispatchEvent(new CustomEvent(OPEN_ENTRY_EVENT, { detail: id }));
        }
      }}
    >
      <ViewTransition name={`entry-${id}`} share="entry-morph" default="none">
        <span>{label}</span>
      </ViewTransition>
    </Link>
  );
}
