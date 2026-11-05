"use client";

import { lazy, Suspense, useState } from "react";
import { HoldButton } from "../ui/HoldButton";
import { Button } from "../ui/Button";
import { useStatus } from "./StatusProvider";
import styles from "./shell.module.css";

// The unlock form is used once per session: load it on demand (JS budget, D13).
const UnlockSheet = lazy(() => import("./UnlockSheet"));

/** The kill switch. Hold 1.2s (or hold Enter/Space). Halting is one-way from the web. */
export function KillSwitch({ placement }: { placement: "strip" | "bar" }) {
  const { live, operatorEnabled, token, setToken, engageHalt, halting } = useStatus();
  const [error, setError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const halted = live.killSwitch.engaged || live.killSwitch.configFlag;

  let control;
  if (halted) {
    control = <span className={styles.haltedLabel}>Halted</span>;
  } else if (!operatorEnabled) {
    control = (
      <a className={styles.readOnly} href="/security#operator">
        Halt from the server
      </a>
    );
  } else if (!token) {
    control = (
      <Button variant="danger" onClick={() => setUnlockOpen(true)}>
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
    <div className={`${styles.kill} ${placement === "bar" ? styles.killBar : ""}`}>
      {control}
      <span className={styles.killError} role="alert">
        {error ?? ""}
      </span>
      {unlockOpen ? (
        <Suspense fallback={null}>
          <UnlockSheet onClose={() => setUnlockOpen(false)} onToken={setToken} />
        </Suspense>
      ) : null}
    </div>
  );
}
