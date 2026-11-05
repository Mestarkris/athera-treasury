import { PublicKey } from "@near-js/crypto";
import { actionCreators, createTransaction } from "@near-js/transactions";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { Ed25519Key, serializeTx } from "../src/index.ts";

// Our hand-written Borsh encoder must be byte-identical to the reference near-js serializer.
describe("transaction encoding vs near-js", () => {
  it("matches for FunctionCall + AddKey(FullAccess) + DeleteKey", () => {
    const k = Ed25519Key.generate().key;
    const owner = Ed25519Key.generate().key;
    const blockHash = base58.encode(new Uint8Array(32).fill(3));
    const ours = serializeTx({
      signerId: "abc.near",
      publicKeyRaw: k.publicKeyRaw,
      nonce: 77n,
      receiverId: "intents.near",
      blockHash,
      actions: [
        { type: "FunctionCall", methodName: "execute_intents", args: { signed: [] }, gas: 100_000_000_000_000n, deposit: 0n },
        { type: "FunctionCall", methodName: "add_public_key", args: { public_key: owner.publicKey }, gas: 30_000_000_000_000n, deposit: 1n },
        { type: "AddFullAccessKey", publicKey: owner.publicKey },
        { type: "DeleteKey", publicKey: k.publicKey },
      ],
    });
    const ref = createTransaction(
      "abc.near",
      PublicKey.from(k.publicKey),
      "intents.near",
      77n,
      [
        actionCreators.functionCall("execute_intents", { signed: [] }, 100_000_000_000_000n, 0n),
        actionCreators.functionCall("add_public_key", { public_key: owner.publicKey }, 30_000_000_000_000n, 1n),
        actionCreators.addKey(PublicKey.from(owner.publicKey), actionCreators.fullAccessKey()),
        actionCreators.deleteKey(PublicKey.from(k.publicKey)),
      ],
      base58.decode(blockHash),
    ).encode();
    expect(Buffer.from(ours).equals(Buffer.from(ref))).toBe(true);
  });
});
