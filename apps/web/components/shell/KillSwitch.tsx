"use client";

import { lazy, Suspense, useState } from "react";
import { cn } from "../../lib/utils";
import { HoldButton } from "../ui/hold-button";
import { useStatus } from "./StatusProvider";

// The unlock form is used once per session: load it on demand (JS budget, D13).
const UnlockSheet = lazy(() => import("./UnlockSheet"));

const pill = "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap pointer-coarse:h-11";

/**
 * The kill switch (design system §4.7). Hold 1.2s (or hold Enter/Space). The halt request is sent
 * the moment the hold completes; the fill animation never delays it. Halting is one-way from the web.
 */
export function KillSwitch({ floating = false }: { floating?: boolean }) {
  const { live, operatorEnabled, token, setToken, engageHalt, halting } = useStatus();
  const [error, setError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const halted = live.killSwitch.engaged || live.killSwitch.configFlag;
  const shadow = floating && "shadow-lift";

  let control;
  if (halted) {
    control = (
      <span className={cn(pill, "bg-destructive dark:text-background text-white", shadow)} role="status">
        <span aria-hidden="true" className="size-2 rounded-full bg-current" />
        Halted{live.killSwitch.since ? ` · ${live.killSwitch.since.slice(11, 19)}` : ""}
      </span>
    );
  } else if (!operatorEnabled) {
    control = (
      <a href="/security#operator" className={cn(pill, "border-border bg-background border", shadow)}>
        <span aria-hidden="true" className="bg-block-dot size-2 rounded-full" />
        Halt from the server
      </a>
    );
  } else if (!token) {
    control = (
      <button type="button" onClick={() => setUnlockOpen(true)} className={cn(pill, "border-border bg-background hover:bg-surface-1 border", shadow)} aria-describedby="ks-locked">
        <span aria-hidden="true" className="bg-block-dot size-2 rounded-full" />
        Kill switch
        <span id="ks-locked" className="visually-hidden">
          Locked. Enter the operator token to arm it.
        </span>
      </button>
    );
  } else {
    control = (
      <HoldButton
        onConfirm={async () => {
          setError(null);
          const err = await engageHalt();
          if (err) {
            setError(err);
            if (/token/i.test(err)) setToken(null);
          }
        }}
        holdingLabel="Keep holding"
        hint="Kill switch. Press and hold for 1.2 seconds, or hold Enter or Space. Stops every agent at its next step; nothing new is signed or submitted."
        disabled={halting}
        className={cn(shadow || undefined)}
      >
        {halting ? "Halting…" : "Kill switch"}
      </HoldButton>
    );
  }

  return (
    <div className={cn("flex items-center gap-3", floating && "flex-col items-end")}>
      {error ? (
        <span role="alert" className="text-destructive bg-background max-w-[28ch] rounded-md text-xs">
          {error}
        </span>
      ) : null}
      {control}
      {unlockOpen ? (
        <Suspense fallback={null}>
          <UnlockSheet onClose={() => setUnlockOpen(false)} onToken={setToken} />
        </Suspense>
      ) : null}
    </div>
  );
}
