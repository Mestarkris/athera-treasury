import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { base58, base64, hex } from "@scure/base";
import { BorshWriter } from "../near/borsh.ts";

/** 2^31 + 413, see NEP-461 / near/intents crates/signatures/nep413. */
export const NEP413_TAG = (1 << 31 >>> 0) + 413;

export interface Nep413Payload {
  message: string;
  nonce: Uint8Array; // 32 bytes
  recipient: string;
  callbackUrl?: string;
}

/** sha256(borsh(u32 tag, payload)). This digest is what gets signed and is the verifier's `intent_hash`. */
export function nep413Prehash(p: Nep413Payload): Uint8Array {
  const w = new BorshWriter()
    .u32(NEP413_TAG)
    .string(p.message)
    .fixed(p.nonce, 32)
    .string(p.recipient)
    .option(p.callbackUrl, (w, v) => w.string(v));
  return sha256(w.done());
}

/** VersionedNonce prefix: first 4 bytes of sha256("<versioned_nonce>"), see defuse core nonce/versioned.rs. */
export const VERSIONED_MAGIC_PREFIX = hex.decode("5628f6c6");

/**
 * VersionedNonce::V1 = MAGIC(4) || variant 0 (1) || salt(4) || deadline i64 ns LE (8) || random(15).
 * The salt must equal `intents.near.current_salt()`; the deadline bounds replay.
 */
export function versionedNonce(saltHex: string, deadline: Date, random: Uint8Array = randomBytes(15)): Uint8Array {
  const salt = hex.decode(saltHex);
  if (salt.length !== 4) throw new Error("salt must be 4 bytes");
  if (random.length !== 15) throw new Error("nonce randomness must be 15 bytes");
  const out = new BorshWriter()
    .fixed(VERSIONED_MAGIC_PREFIX, 4)
    .u8(0)
    .fixed(salt, 4)
    .i64(BigInt(deadline.getTime()) * 1_000_000n)
    .fixed(random, 15)
    .done();
  if (out.length !== 32) throw new Error("nonce must be 32 bytes");
  return out;
}

/** The JSON shape `execute_intents` / `simulate_intents` accept for a NEP-413 signed payload. */
export interface SignedNep413Json {
  standard: "nep413";
  payload: { message: string; nonce: string; recipient: string };
  public_key: string;
  signature: string;
}

export function toSignedJson(p: Nep413Payload, publicKey: string, signature: Uint8Array): SignedNep413Json {
  return {
    standard: "nep413",
    payload: { message: p.message, nonce: base64.encode(p.nonce), recipient: p.recipient },
    public_key: publicKey,
    signature: `ed25519:${base58.encode(signature)}`,
  };
}
