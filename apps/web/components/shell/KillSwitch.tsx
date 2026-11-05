"use client";

import { Lock, OctagonX } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Button } from "../ui/button";
import { HoldButton } from "../ui/hold-button";
import { useStatus } from "./StatusProvider";

// The unlock form is used once per session: load it on demand (JS budget, D13).
const UnlockSheet = lazy(() => import("./UnlockSheet"));

/** The kill switch. Hold 1.2s (or hold Enter/Space). Halting is one-way from the web. */
export function KillSwitch() {
  const { live, operatorEnabled, token, setToken, engageHalt, halting } = useStatus();
  const [error, setError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const halted = live.killSwitch.engaged || live.killSwitch.configFlag;

  let control;
  if (halted) {
    control = (
      <span className="bg-destructive dark:text-background inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-white pointer-coarse:h-11">
        <OctagonX className="size-4" aria-hidden="true" />
        Halted
      </span>
    );
  } else if (!operatorEnabled) {
    control = (
      <Button variant="link" size="sm" asChild>
        <a href="/security#operator">Halt from the server</a>
      </Button>
    );
  } else if (!token) {
    control = (
      <Button variant="outline" size="sm" onClick={() => setUnlockOpen(true)} className="text-destructive border-destructive/50">
        <Lock aria-hidden="true" />
        Unlock kill switch
      </Button>
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
        holdingLabel="Keep holding to halt"
        hint="Kill switch. Press and hold for 1.2 seconds, or hold Enter or Space. Stops every agent at its next step; nothing new is signed or submitted."
        disabled={halting}
      >
        {halting ? "Halting…" : "Hold to halt"}
      </HoldButton>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {control}
      {error ? (
        <span role="alert" className="text-destructive max-w-[28ch] text-xs">
          {error}
        </span>
      ) : null}
      {unlockOpen ? (
        <Suspense fallback={null}>
          <UnlockSheet onClose={() => setUnlockOpen(false)} onToken={setToken} />
        </Suspense>
      ) : null}
    </div>
  );
}
