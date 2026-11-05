import { ViewTransition, type ReactNode } from "react";

/**
 * Hierarchical page motion (ledger list ↔ entry detail). Only typed navigations animate:
 * `nav-forward` slides the new page in from the right, `nav-back` from the left. Untyped
 * navigations (nav links, browser back) do not slide; the shared entry morph still plays.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "page-from-right", "nav-back": "page-from-left", default: "none" }}
      exit={{ "nav-forward": "page-to-left", "nav-back": "page-to-right", default: "none" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
