import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";

/** `ed25519:<base58>` public key string, as NEAR prints it. */
export type PublicKeyString = `ed25519:${string}`;

export const encodePublicKey = (raw: Uint8Array): PublicKeyString => `ed25519:${base58.encode(raw)}`;

export function decodePublicKey(s: string): Uint8Array {
  if (!s.startsWith("ed25519:")) throw new Error("only ed25519 keys are supported");
  const raw = base58.decode(s.slice("ed25519:".length));
  if (raw.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  return raw;
}

/**
 * A key held in memory only. Constructed from an env var at process start; the secret is
 * never exposed again, never logged, never serialized.
 */
export class Ed25519Key {
  readonly publicKey: PublicKeyString;
  readonly publicKeyRaw: Uint8Array;
  readonly #seed: Uint8Array;

  private constructor(seed: Uint8Array) {
    this.#seed = seed;
    this.publicKeyRaw = ed25519.getPublicKey(seed);
    this.publicKey = encodePublicKey(this.publicKeyRaw);
  }

  /** Accepts NEAR's `ed25519:<base58 of 64 bytes seed||pub>` (or a 32-byte seed). */
  static fromSecret(secret: string): Ed25519Key {
    if (!secret.startsWith("ed25519:")) throw new Error("secret key must start with ed25519:");
    const raw = base58.decode(secret.slice("ed25519:".length));
    if (raw.length !== 64 && raw.length !== 32) throw new Error("ed25519 secret must be 32 or 64 bytes");
    const key = new Ed25519Key(raw.slice(0, 32));
    if (raw.length === 64 && base58.encode(raw.slice(32)) !== base58.encode(key.publicKeyRaw)) {
      throw new Error("secret key's embedded public key does not match its seed");
    }
    return key;
  }

  static generate(): { key: Ed25519Key; secret: string } {
    const seed = ed25519.utils.randomSecretKey();
    const key = new Ed25519Key(seed);
    const full = new Uint8Array(64);
    full.set(seed, 0);
    full.set(key.publicKeyRaw, 32);
    return { key, secret: `ed25519:${base58.encode(full)}` };
  }

  sign(message: Uint8Array): Uint8Array {
    return ed25519.sign(message, this.#seed);
  }

  toJSON(): { publicKey: string } {
    return { publicKey: this.publicKey };
  }
}

export const verifyEd25519 = (sig: Uint8Array, msg: Uint8Array, pub: Uint8Array) => ed25519.verify(sig, msg, pub);
