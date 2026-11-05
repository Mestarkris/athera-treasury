import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64 } from "@scure/base";
import { BorshWriter } from "./borsh.ts";
import { decodePublicKey, type Ed25519Key } from "./keys.ts";

/** The subset of nearcore actions this project ever signs. */
export type Action =
  | { type: "FunctionCall"; methodName: string; args: unknown; gas: bigint; deposit: bigint }
  | { type: "DeleteKey"; publicKey: string }
  /** Only FullAccess is supported: used once in setup to hand an account to its owner's wallet key. */
  | { type: "AddFullAccessKey"; publicKey: string };

export interface Tx {
  signerId: string;
  publicKeyRaw: Uint8Array;
  nonce: bigint;
  receiverId: string;
  blockHash: string; // base58
  actions: Action[];
}

/** Kept for the settlement path: a single FunctionCall. */
export interface FunctionCallTx extends Omit<Tx, "actions"> {
  methodName: string;
  args: unknown;
  gas: bigint;
  deposit: bigint;
}

const ED25519 = 0;
const ACTION_FUNCTION_CALL = 2;
const ACTION_ADD_KEY = 5;
const ACTION_DELETE_KEY = 6;
const PERMISSION_FULL_ACCESS = 1;

const toTx = (t: FunctionCallTx | Tx): Tx =>
  "actions" in t
    ? t
    : {
        signerId: t.signerId,
        publicKeyRaw: t.publicKeyRaw,
        nonce: t.nonce,
        receiverId: t.receiverId,
        blockHash: t.blockHash,
        actions: [{ type: "FunctionCall", methodName: t.methodName, args: t.args, gas: t.gas, deposit: t.deposit }],
      };

/** Borsh-serialize a NEAR transaction (nearcore `Transaction::V0`). */
export function serializeTx(input: FunctionCallTx | Tx): Uint8Array {
  const t = toTx(input);
  const w = new BorshWriter()
    .string(t.signerId)
    .u8(ED25519)
    .fixed(t.publicKeyRaw, 32)
    .u64(t.nonce)
    .string(t.receiverId)
    .fixed(base58.decode(t.blockHash), 32)
    .u32(t.actions.length);
  for (const a of t.actions) {
    if (a.type === "FunctionCall") {
      w.u8(ACTION_FUNCTION_CALL)
        .string(a.methodName)
        .bytes(new TextEncoder().encode(JSON.stringify(a.args)))
        .u64(a.gas)
        .u128(a.deposit);
    } else if (a.type === "AddFullAccessKey") {
      // AccessKey { nonce: u64, permission: AccessKeyPermission::FullAccess }
      w.u8(ACTION_ADD_KEY).u8(ED25519).fixed(decodePublicKey(a.publicKey), 32).u64(0n).u8(PERMISSION_FULL_ACCESS);
    } else {
      w.u8(ACTION_DELETE_KEY).u8(ED25519).fixed(decodePublicKey(a.publicKey), 32);
    }
  }
  return w.done();
}

export interface SignedTx {
  /** base58 sha256 of the serialized transaction: the hash every explorer shows. */
  hash: string;
  base64: string;
}

export function signTx(t: FunctionCallTx | Tx, key: Ed25519Key): SignedTx {
  const body = serializeTx(t);
  const digest = sha256(body);
  const sig = key.sign(digest);
  const signed = new BorshWriter().fixed(body, body.length).u8(ED25519).fixed(sig, 64).done();
  return { hash: base58.encode(digest), base64: base64.encode(signed) };
}
