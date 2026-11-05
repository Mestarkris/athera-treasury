import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface KillSwitchState {
  readonly engaged: boolean;
  readonly reason?: string;
  readonly since?: string;
}

/**
 * Operator halt. Checked synchronously before every stage, before signing and before
 * submission. Engaging it never waits on anything.
 */
export interface KillSwitch {
  state(): KillSwitchState;
  engage(reason: string): void;
  release(): void;
}

export class HaltError extends Error {
  constructor(
    readonly stage: string,
    readonly reason: string,
  ) {
    super(`Halted before ${stage}: ${reason}`);
    this.name = "HaltError";
  }
}

/** File-backed switch so a separate process (CLI, web route) can halt a running loop. */
export class FileKillSwitch implements KillSwitch {
  constructor(private readonly path: string) {}

  state(): KillSwitchState {
    if (!existsSync(this.path)) return { engaged: false };
    try {
      const v = JSON.parse(readFileSync(this.path, "utf8")) as { reason?: unknown; since?: unknown };
      return {
        engaged: true,
        reason: typeof v.reason === "string" ? v.reason : "halt file present",
        ...(typeof v.since === "string" ? { since: v.since } : {}),
      };
    } catch {
      // Unreadable halt file still means halted: fail closed.
      return { engaged: true, reason: "halt file present (unreadable)" };
    }
  }

  engage(reason: string): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ reason, since: new Date().toISOString() }));
  }

  release(): void {
    rmSync(this.path, { force: true });
  }
}

export class MemoryKillSwitch implements KillSwitch {
  private s: KillSwitchState = { engaged: false };
  state(): KillSwitchState {
    return this.s;
  }
  engage(reason: string): void {
    this.s = { engaged: true, reason, since: new Date().toISOString() };
  }
  release(): void {
    this.s = { engaged: false };
  }
}
