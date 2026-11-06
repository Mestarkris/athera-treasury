// config.yaml version history from git, for the policy page. The hosted site has no git, so the
// worker reads it here and publishes it; locally the site calls it directly.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

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

const gitIn = (root: string) => (args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

/**
 * Version history of config.yaml, newest first, straight from git (edits go through git;
 * the interface never writes policy). Returns [] when nothing is committed yet.
 */
export function policyHistoryFromGit(root: string): PolicyCommit[] {
  const git = gitIn(root);
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
export function policyDirtyFromGit(root: string): boolean {
  const git = gitIn(root);
  try {
    return git(["status", "--porcelain", "--", "config.yaml"]).trim().length > 0;
  } catch {
    return false;
  }
}
