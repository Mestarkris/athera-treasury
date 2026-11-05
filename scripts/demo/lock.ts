// Single-writer lock for the ledger. FileLedger keeps the chain head in memory, so two processes
// appending at once would fork the hash chain. Every writer (CLI demo, phase1, UI-started runs)
// takes this lock first. Stale locks (dead pid) are taken over.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export interface RunLock {
  release(): void;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLock(path: string): { pid: number; runId: string; since: string } | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as { pid: number; runId: string; since: string };
    return alive(v.pid) ? v : null;
  } catch {
    return null;
  }
}

export function acquireRunLock(path: string, runId: string): RunLock {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, runId, since: new Date().toISOString() }));
      closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        rmSync(path, { force: true });
      };
      process.once("exit", release);
      return { release };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = readLock(path);
      if (holder) throw new Error(`another run is writing the ledger (run ${holder.runId}, pid ${holder.pid}, since ${holder.since})`);
      rmSync(path, { force: true }); // stale: holder is dead
    }
  }
  throw new Error("could not acquire the run lock");
}
