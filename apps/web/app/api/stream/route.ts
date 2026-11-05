import { openSync, readSync, closeSync, statSync } from "node:fs";
import type { LedgerEntry } from "@athera/ledger";
import { LEDGER_PATH, readLedger } from "../../../lib/ledger";
import { killSwitchState, readRunLock } from "../../../lib/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-sent events. Tails the append-only ledger file and pushes every new entry the moment
 * it is written (by any process: the CLI demo or a UI-started run), plus kill-switch and run-lock
 * changes. `?after=<seq>` replays entries after that seq first.
 */
export function GET(req: Request) {
  const after = Number(new URL(req.url).searchParams.get("after") ?? "NaN");
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      let offset = 0;
      try {
        offset = statSync(LEDGER_PATH).size;
      } catch {
        offset = 0;
      }
      if (Number.isFinite(after)) {
        for (const e of readLedger().entries) if (e.seq > after) send("entry", e);
      }
      let status = JSON.stringify({ killSwitch: killSwitchState(), run: readRunLock() });
      send("status", JSON.parse(status));
      let partial = "";

      timer = setInterval(() => {
        try {
          const size = statSync(LEDGER_PATH).size;
          if (size > offset) {
            const fd = openSync(LEDGER_PATH, "r");
            const buf = Buffer.alloc(size - offset);
            readSync(fd, buf, 0, buf.length, offset);
            closeSync(fd);
            offset = size;
            const text = partial + buf.toString("utf8");
            const lines = text.split("\n");
            partial = lines.pop() ?? "";
            for (const l of lines) if (l.trim()) send("entry", JSON.parse(l) as LedgerEntry);
          }
        } catch {
          // ledger not created yet
        }
        const next = JSON.stringify({ killSwitch: killSwitchState(), run: readRunLock() });
        if (next !== status) {
          status = next;
          send("status", JSON.parse(next));
        }
      }, 400);
      beat = setInterval(() => controller.enqueue(enc.encode(": keep-alive\n\n")), 15_000);
    },
    cancel() {
      clearInterval(timer);
      clearInterval(beat);
    },
  });
  req.signal.addEventListener("abort", () => {
    clearInterval(timer);
    clearInterval(beat);
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store, no-transform", connection: "keep-alive" } });
}
