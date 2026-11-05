import "server-only";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ROOT } from "./ledger";

export interface PolicyCommit {
  commit: string;
  date: string;
  subject: string;
  /** sha256 of config.yaml at this commit: the same hash every policy check records. */
  hash: string;
  version: number | null;
  /** Unified diff against the previous committed version (empty for the first). */
  diff: string;
  source: string;
}

const git = (args: string[]) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });

/**
 * Version history of config.yaml, newest first, straight from git (edits go through git;
 * the interface never writes policy). Returns [] when nothing is committed yet.
 */
export function policyHistory(): PolicyCommit[] {
  let log: string;
  try {
    log = git(["log", "--format=%H%x1f%aI%x1f%s", "--", "config.yaml"]);
  } catch {
    return [];
  }
  const rows = log.trim().split("\n").filter(Boolean).map((l) => l.split("\x1f") as [string, string, string]);
  return rows.map(([commit, date, subject], i) => {
    const source = git(["show", `${commit}:config.yaml`]);
    const parent = rows[i + 1]?.[0];
    const diff = parent ? git(["diff", "--no-color", "-U2", parent, commit, "--", "config.yaml"]).split("\n").slice(4).join("\n") : "";
    const version = /^version:\s*(\d+)/m.exec(source)?.[1];
    return { commit, date, subject, hash: createHash("sha256").update(source).digest("hex"), version: version ? Number(version) : null, diff, source };
  });
}

/** Working tree vs the latest commit: true if config.yaml has uncommitted edits. */
export function policyDirty(): boolean {
  try {
    return git(["status", "--porcelain", "--", "config.yaml"]).trim().length > 0;
  } catch {
    return false;
  }
}
