"use client";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Sheet } from "../ui/sheet";

/** Operator token entry. Kept for this browser tab only (sessionStorage). */
export default function UnlockSheet({ onClose, onToken }: { onClose: () => void; onToken: (t: string) => void }) {
  return (
    <Sheet open onClose={onClose} title="Unlock operator controls">
      <form
        className="grid max-w-md gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get("token");
          if (typeof v === "string" && v.trim()) {
            onToken(v.trim());
            onClose();
          }
        }}
      >
        <p className="text-muted-foreground text-sm">
          The kill switch and the demo run buttons need the operator token. It is in <code className="data">apps/web/.env.local</code> on the server (
          <code className="data">ATHERA_OPERATOR_TOKEN</code>). It is kept for this browser tab only.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="operator-token">Operator token</Label>
          <Input id="operator-token" name="token" type="password" autoComplete="off" spellCheck={false} required className="data" />
        </div>
        <Button type="submit">Unlock</Button>
      </form>
    </Sheet>
  );
}
