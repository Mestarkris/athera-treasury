"use client";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import styles from "./shell.module.css";

/** Operator token entry. Kept for this browser tab only (sessionStorage). */
export default function UnlockSheet({ onClose, onToken }: { onClose: () => void; onToken: (t: string) => void }) {
  return (
    <Sheet open onClose={onClose} title="Unlock operator controls">
      <form
        className={styles.unlock}
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get("token");
          if (typeof v === "string" && v.trim()) {
            onToken(v.trim());
            onClose();
          }
        }}
      >
        <p>
          The kill switch and the demo run buttons need the operator token. It is in <code className="data">apps/web/.env.local</code> on the server
          (<code className="data">ATHERA_OPERATOR_TOKEN</code>). It is kept for this browser tab only.
        </p>
        <label className={styles.field}>
          <span>Operator token</span>
          <input name="token" type="password" autoComplete="off" spellCheck={false} required className="data" />
        </label>
        <Button type="submit" variant="primary">
          Unlock
        </Button>
      </form>
    </Sheet>
  );
}
