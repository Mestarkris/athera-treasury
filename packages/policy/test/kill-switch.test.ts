import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileKillSwitch } from "../src/index.ts";

describe("FileKillSwitch", () => {
  const path = () => join(mkdtempSync(join(tmpdir(), "athera-ks-")), "HALT");
  it("a halt engaged by one instance (another process) is seen immediately by another", () => {
    const p = path();
    const operator = new FileKillSwitch(p);
    const loop = new FileKillSwitch(p);
    expect(loop.state().engaged).toBe(false);
    operator.engage("operator pressed halt");
    expect(loop.state()).toMatchObject({ engaged: true, reason: "operator pressed halt" });
    operator.release();
    expect(loop.state().engaged).toBe(false);
  });
  it("fails closed on an unreadable halt file", () => {
    const p = path();
    writeFileSync(p, "{not json");
    expect(new FileKillSwitch(p).state()).toMatchObject({ engaged: true });
  });
});
