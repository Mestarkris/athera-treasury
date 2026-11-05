"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_ENTRY_EVENT } from "./EntryLink";

// The sheet's code loads on the first tap, not with the page (JS budget, D13).
// React.lazy (already in React) rather than next/dynamic, which adds its own runtime.
const EntrySheet = lazy(() => import("./EntrySheet"));

/** Listens for row taps on narrow screens and opens the entry sheet. */
export function EntrySheetHost() {
  const [id, setId] = useState<string | null>(null);
  const [used, setUsed] = useState(false);
  useEffect(() => {
    const open = (ev: Event) => {
      setUsed(true);
      setId((ev as CustomEvent<string>).detail);
    };
    window.addEventListener(OPEN_ENTRY_EVENT, open);
    return () => window.removeEventListener(OPEN_ENTRY_EVENT, open);
  }, []);
  return used ? (
    <Suspense fallback={null}>
      <EntrySheet id={id} onClose={() => setId(null)} />
    </Suspense>
  ) : null;
}
