import { base58, base64, hex } from "@scure/base";
import { describe, expect, it, vi } from "vitest";
import { MemoryKillSwitch, PolicyEngine, type PassedPolicyCheck, type PolicyCheck } from "@athera/policy";
import { FIXTURE_YAML, state, transfer } from "../../policy/test/fixtures.ts";
import {
  AuthorizationError,
  Ed25519Key,
  NEP413_TAG,
  Settlement,
  nep413Prehash,
  serializeTx,
  verifyEd25519,
  versionedNonce,
  type IntentSigner,
} from "../src/index.ts";
import { FakeChain } from "./fake-chain.ts";

describe("NEP-413", () => {
  it("tag is 2^31 + 413", () => expect(NEP413_TAG).toBe(2147484061));

  it("matches the official near/intents test vector", () => {
    // crates/signatures/nep413/src/lib.rs, test verify_ok
    const pub = hex.decode("e2e9cb7ac57cb46d4da1ce1d1cc2c33bdfe17407c517916b522724a8ea2c6c50");
    const sig = hex.decode(
      "e2ff6254871a3fec1853c167b42f0f14248c4cf7fef5452dc24d8dbdc5c4bf183ab707322b4d782d5f5a05571bae476c5f7ee41c473f3002e600865e46b75d0f",
    );
    const digest = nep413Prehash({ message: "Hello, world!", nonce: new Uint8Array(32), recipient: "intents.near" });
    expect(verifyEd25519(sig, digest, pub)).toBe(true);
  });

  it("builds a 32-byte VersionedNonce V1 with magic, salt and ns deadline", () => {
    const deadline = new Date("2026-11-05T12:00:00.000Z");
    const n = versionedNonce("252812b3", deadline, new Uint8Array(15).fill(9));
    expect(n).toHaveLength(32);
    expect(hex.encode(n.slice(0, 4))).toBe("5628f6c6");
    expect(n[4]).toBe(0);
    expect(hex.encode(n.slice(5, 9))).toBe("252812b3");
    expect(new DataView(n.buffer).getBigInt64(9, true)).toBe(BigInt(deadline.getTime()) * 1_000_000n);
    expect([...n.slice(17)]).toEqual(new Array(15).fill(9));
  });
});

describe("transaction encoding", () => {
  it("serializes signer, key, nonce, receiver, block hash and one FunctionCall", () => {
    const { key } = Ed25519Key.generate();
    const bytes = serializeTx({
      signerId: "a.near",
      publicKeyRaw: key.publicKeyRaw,
      nonce: 5n,
      receiverId: "intents.near",
      blockHash: base58.encode(new Uint8Array(32)),
      methodName: "execute_intents",
      args: { signed: [] },
      gas: 100n,
      deposit: 0n,
    });
    // 4+6 signer, 1+32 key, 8 nonce, 4+12 receiver, 32 hash, 4 actions len, 1 tag, 4+15 method, 4+13 args, 8 gas, 16 deposit
    expect(bytes.length).toBe(10 + 33 + 8 + 16 + 32 + 4 + 1 + 19 + 17 + 8 + 16);
    expect(bytes[bytes.length - 16 - 8 - 17 - 19 - 1]).toBe(2); // Action::FunctionCall
  });
});

describe("keys", () => {
  it("round-trips a NEAR secret and never serializes it", () => {
    const { key, secret } = Ed25519Key.generate();
    const again = Ed25519Key.fromSecret(secret);
    expect(again.publicKey).toBe(key.publicKey);
    expect(JSON.stringify(again)).not.toContain(secret.slice(8, 20));
  });
});

function setup() {
  const policy = PolicyEngine.fromSource(FIXTURE_YAML);
  const chain = new FakeChain();
  const killSwitch = new MemoryKillSwitch();
  const key = Ed25519Key.generate().key;
  const sign = vi.fn((d: Uint8Array) => key.sign(d));
  const signer: IntentSigner = { accountId: "dao-treasury.near", publicKey: key.publicKey, sign };
  const settlement = new Settlement({ chain, policy, killSwitch, intentSigners: [signer], submitter: { accountId: "dao-treasury.near", key } });
  return { policy, chain, killSwitch, sign, settlement };
}

const passed = (c: PolicyCheck): PassedPolicyCheck => {
  if (c.result !== "pass") throw new Error(c.summary);
  return c;
};

describe("Settlement", () => {
  it("creates, signs, submits and confirms a passed proposal", async () => {
    const { policy, chain, sign, settlement } = setup();
    const created = await settlement.create(passed(policy.validate(transfer(), state())));
    expect(sign).not.toHaveBeenCalled(); // creation never signs
    expect(created.memo).toMatch(/^athera:p-1:[0-9a-f]{8}$/);
    const sub = await settlement.submit(created);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(chain.calls).toEqual(["currentSalt", "simulate", "accessKeyNonce", "broadcast"]);
    expect(base64.decode(sub.signed.payload.nonce)).toHaveLength(32);
    const settled = await settlement.track(sub);
    expect(settled.blockHeight).toBe(123_456);
    expect(settled.events[0]?.data[0]?.["intent_hash"]).toBe(created.intentHash);
  });

  it("refuses a forged check without touching the signer or the network", async () => {
    const { policy, chain, sign, settlement } = setup();
    const real = passed(policy.validate(transfer(), state()));
    const forged = { ...real } as PassedPolicyCheck;
    await expect(settlement.create(forged)).rejects.toBeInstanceOf(AuthorizationError);
    expect(sign).not.toHaveBeenCalled();
    expect(chain.calls).toEqual([]);
  });

  it("refuses a blocked check even if cast to a pass", async () => {
    const { policy, chain, sign, settlement } = setup();
    const blocked = policy.validate(transfer({ chain: "eth" }), state());
    expect(blocked.result).toBe("block");
    await expect(settlement.create(blocked as unknown as PassedPolicyCheck)).rejects.toBeInstanceOf(AuthorizationError);
    expect(sign).not.toHaveBeenCalled();
    expect(chain.calls).toEqual([]);
  });

  it("refuses a stale check and a reused check", async () => {
    const { policy, settlement } = setup();
    const c = passed(policy.validate(transfer(), state()));
    await settlement.create(c);
    await expect(settlement.create(c)).rejects.toThrow(/already used/);
    const late = new Settlement({
      chain: new FakeChain(),
      policy,
      killSwitch: new MemoryKillSwitch(),
      intentSigners: [],
      submitter: { accountId: "x.near", key: Ed25519Key.generate().key },
      now: () => new Date(Date.now() + 120_000),
    });
    await expect(late.create(passed(policy.validate(transfer(), state())))).rejects.toThrow(/old/);
  });

  it("refuses a check made under a different policy version", async () => {
    const { settlement } = setup();
    const other = PolicyEngine.fromSource(FIXTURE_YAML.replace("version: 3", "version: 4"));
    await expect(settlement.create(passed(other.validate(transfer(), state())))).rejects.toThrow(/policy changed/);
  });

  it("does not sign when the kill switch is engaged between creation and signing", async () => {
    const { policy, chain, killSwitch, sign, settlement } = setup();
    const created = await settlement.create(passed(policy.validate(transfer(), state())));
    killSwitch.engage("operator");
    await expect(settlement.submit(created)).rejects.toMatchObject({ name: "HaltError", stage: "signing" });
    expect(sign).not.toHaveBeenCalled();
    expect(chain.calls).not.toContain("broadcast");
  });

  it("reports an on-chain failure instead of confirming", async () => {
    const { policy, chain, settlement } = setup();
    chain.failTx = true;
    const sub = await settlement.submit(await settlement.create(passed(policy.validate(transfer(), state()))));
    await expect(settlement.track(sub)).rejects.toThrow(/failed on-chain/);
  });
});
