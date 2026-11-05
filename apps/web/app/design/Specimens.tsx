"use client";

import { useState } from "react";
import { HoldButton } from "../../components/ui/HoldButton";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import styles from "./design.module.css";

/** HoldButton specimen. It confirms locally only; it does NOT touch the real kill switch. */
export function HoldSpecimen() {
  const [at, setAt] = useState<string | null>(null);
  return (
    <div className={styles.inline}>
      <HoldButton
        onConfirm={() => setAt(new Date().toLocaleTimeString())}
        holdingLabel="Keep holding"
        hint="Specimen. Press and hold for 1.2 seconds, or hold Enter or Space. Confirms locally only."
      >
        Hold to confirm
      </HoldButton>
      <span className={styles.note} aria-live="polite">
        {at ? `Confirmed locally at ${at}. Specimen only: nothing was halted.` : "Specimen: confirms locally, sends nothing."}
      </span>
    </div>
  );
}

export function SheetSpecimen({ title, json }: { title: string; json: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open entry in a sheet</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <pre className={`${styles.json} data`}>{json}</pre>
      </Sheet>
    </>
  );
}
