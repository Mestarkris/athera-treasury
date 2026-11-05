import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileLedger, MemoryLedger, verifyChain, type LedgerEntryInput } from "../src/index.ts";

const input = (n: number): LedgerEntryInput => ({
  run_id: "r1",
  agent: "policy",
  type: "policy_check",
  result: n % 2 ? "block" : "pass",
  summary: `check ${n}`,
  policy: { version: 1, hash: "a".repeat(64) },
  refs: { proposal_id: `p-${n}` },
});

describe("ledger", () => {
  it("chains entries and verifies", () => {
    const l = new MemoryLedger();
    const a = l.append(input(0));
    const b = l.append({ ...input(1), upstream: [a.id] });
    expect(b.prev_hash).toBe(a.hash);
    expect(a.id).toHaveLength(16);
    expect(l.get(b.id)?.upstream).toEqual([a.id]);
    expect(verifyChain(l.all())).toEqual({ ok: true });
  });

  it("detects a tampered entry", () => {
    const l = new MemoryLedger();
    l.append(input(0));
    l.append(input(1));
    const tampered = l.all().map((e, i) => (i === 0 ? { ...e, summary: "rewritten" } : e));
    expect(verifyChain(tampered)).toMatchObject({ ok: false, seq: 0, reason: "hash mismatch" });
  });

  it("persists append-only and reloads with an intact chain", () => {
    const path = join(mkdtempSync(join(tmpdir(), "athera-")), "ledger.jsonl");
    const l = new FileLedger(path);
    l.append(input(0));
    l.append(input(1));
    const reloaded = new FileLedger(path);
    expect(reloaded.all()).toHaveLength(2);
    reloaded.append(input(2));
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("refuses to open a ledger file whose history was edited", () => {
    const path = join(mkdtempSync(join(tmpdir(), "athera-")), "ledger.jsonl");
    const l = new FileLedger(path);
    l.append(input(0));
    l.append(input(1));
    writeFileSync(path, readFileSync(path, "utf8").replace("check 0", "check X"));
    expect(() => new FileLedger(path)).toThrow(/corrupt at seq 0/);
  });

  it("notifies subscribers in order", () => {
    const l = new MemoryLedger();
    const seen: number[] = [];
    l.subscribe((e) => seen.push(e.seq));
    l.append(input(0));
    l.append(input(1));
    expect(seen).toEqual([0, 1]);
  });
});
