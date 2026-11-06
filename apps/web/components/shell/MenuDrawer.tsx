"use client";

import { ChevronUp } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

export const NAV = [
  { href: "/", label: "Control room" },
  { href: "/demo", label: "Run" },
  { href: "/buy", label: "Buy a report" },
  { href: "/reports", label: "Reports" },
  { href: "/ledger", label: "Ledger" },
  { href: "/policy", label: "Policy" },
  { href: "/security", label: "Security" },
] as const;

/**
 * Full-screen navigation drawer (design system §4.2): opacity fade, links rise 8px with a 40ms
 * stagger. Focus is trapped while open, Esc closes, and focus returns to the Menu button.
 * The kill switch is never in here: it stays in the navbar (§4.7).
 */
export function MenuDrawer({ policyVersion, policyHash }: { policyVersion: number; policyHash: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const path = usePathname();

  useEffect(() => setMounted(true), []);
  // Navigating closes the drawer.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("a,button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("a,button")];
      const a = items[0];
      const z = items.at(-1);
      if (!a || !z) return;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      trigger.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="menu-drawer"
        onClick={() => setOpen((o) => !o)}
        className="bg-primary text-primary-foreground relative inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-transform duration-150 active:scale-[0.98] pointer-coarse:h-11"
        style={{ zIndex: open ? "calc(var(--z-sheet) + 1)" : undefined }}
      >
        {open ? "Close" : "Menu"}
        <ChevronUp aria-hidden="true" className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {mounted
        ? createPortal(
            <div
              id="menu-drawer"
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              data-open={open}
              inert={!open}
              className="bg-background fixed inset-0 flex flex-col opacity-0 transition-opacity duration-[400ms] ease-[var(--ease-out)] data-[open=true]:opacity-100 motion-reduce:transition-none [&:not([data-open=true])]:pointer-events-none"
              style={{ zIndex: "var(--z-sheet)" }}
            >
              <div className="shell flex items-center justify-between pt-[calc(env(safe-area-inset-top)+20px)]">
                <span className="serif-accent text-[30px] leading-none font-semibold" aria-hidden="true">
                  Athera
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="bg-primary text-primary-foreground inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium pointer-coarse:h-11"
                >
                  Close
                  <ChevronUp aria-hidden="true" className="size-4 rotate-180" />
                </button>
              </div>
              <nav aria-label="Main" className="shell flex flex-1 flex-col items-center justify-center gap-1 py-8">
                {NAV.map((n, i) => {
                  const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "text-[32px] leading-[1.2] font-medium tracking-[-0.04em] transition-[opacity,transform] duration-300 ease-[var(--ease-out)] sm:text-[40px] xl:text-[48px]",
                        "translate-y-2 opacity-0 motion-reduce:translate-y-0 motion-reduce:transition-none",
                        open && "translate-y-0 opacity-100",
                        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                      style={{ transitionDelay: open ? `${80 + i * 40}ms` : "0ms" }}
                    >
                      {n.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="shell text-muted-foreground flex flex-wrap items-center justify-between gap-2 pb-[calc(env(safe-area-inset-bottom)+20px)] text-xs">
                <span>© 2026 Athera Treasury · Built for the NEAR Hackathon</span>
                <span className="data">
                  policy v{policyVersion} · {policyHash.slice(0, 6)}
                </span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
