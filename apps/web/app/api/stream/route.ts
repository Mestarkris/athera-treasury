import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { LedgerEntry } from "@athera/ledger";
import { LEDGER_PATH, readLedger, store } from "../../../lib/ledger";
import { killSwitchState, readRunLock } from "../../../lib/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Hosted functions are time-limited; the browser's EventSource reconnects by itself. */
export const maxDuration = 300;

/**
 * Server-sent events: every new ledger entry the moment it is written (by any process), plus
 * kill-switch and run-lock changes. `?after=<seq>` replays entries after that seq first.
 * Locally it tails the ledger file; hosted it polls the store the worker publishes to.
 */
export function GET(req: Request) {
  const after = Number(new URL(req.url).searchParams.get("after") ?? "NaN");
  const enc = new TextEncoder();
  let stopped = false;
  const timers: ReturnType<typeof setInterval>[] = [];
  const stop = () => {
    stopped = true;
    timers.forEach(clearInterval);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (!stopped) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const liveStatus = async () => JSON.stringify({ killSwitch: await killSwitchState(), run: await readRunLock() });

      if (Number.isFinite(after)) for (const e of (await readLedger()).entries) if (e.seq > after) send("entry", e);
      let status = await liveStatus();
      send("status", JSON.parse(status));

      let busy = false;
      const tick = async (pull: () => Promise<void>) => {
        if (busy || stopped) return;
        busy = true;
        try {
          await pull();
          const next = await liveStatus();
          if (next !== status) {
            status = next;
            send("status", JSON.parse(next));
          }
        } catch {
          // store or file briefly unavailable: try again next tick
        } finally {
          busy = false;
        }
      };

      const hostedStore = store;
      if (hostedStore) {
        let offset = await hostedStore.ledgerLength();
        timers.push(
          setInterval(
            () =>
              void tick(async () => {
                const len = await hostedStore.ledgerLength();
                if (len > offset) {
                  for (const e of await hostedStore.ledgerFrom<LedgerEntry>(offset)) send("entry", e);
                  offset = len;
                }
              }),
            2000,
          ),
        );
        // Close shortly before the platform limit; EventSource reconnects.
        setTimeout(() => {
          stop();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }, (maxDuration - 10) * 1000);
      } else {
        let offset = 0;
        try {
          offset = statSync(LEDGER_PATH).size;
        } catch {
          offset = 0;
        }
        let partial = "";
        timers.push(
          setInterval(
            () =>
              void tick(async () => {
                let size = 0;
                try {
                  size = statSync(LEDGER_PATH).size;
                } catch {
                  return; // ledger not created yet
                }
                if (size <= offset) return;
                const fd = openSync(LEDGER_PATH, "r");
                const buf = Buffer.alloc(size - offset);
                readSync(fd, buf, 0, buf.length, offset);
                closeSync(fd);
                offset = size;
                const lines = (partial + buf.toString("utf8")).split("\n");
                partial = lines.pop() ?? "";
                for (const l of lines) if (l.trim()) send("entry", JSON.parse(l) as LedgerEntry);
              }),
            400,
          ),
        );
      }
      timers.push(setInterval(() => !stopped && controller.enqueue(enc.encode(": keep-alive\n\n")), 15_000));
    },
    cancel: stop,
  });
  req.signal.addEventListener("abort", stop);
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store, no-transform", connection: "keep-alive" } });
}
