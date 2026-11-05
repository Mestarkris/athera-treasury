import type { Ed25519Key } from "./near/keys.ts";

/**
 * Signs NEP-413 intent digests for one account inside the verifier. The only object in
 * the system that can authorize value movement. Settlement is the only holder.
 */
export interface IntentSigner {
  readonly accountId: string;
  readonly publicKey: string;
  sign(digest: Uint8Array): Uint8Array;
}

/** Signs the NEAR transaction that submits `execute_intents`. Function-call key only. */
export interface TxSigner {
  readonly accountId: string;
  readonly key: Ed25519Key;
}

export class KeyIntentSigner implements IntentSigner {
  readonly publicKey: string;
  constructor(
    readonly accountId: string,
    private readonly key: Ed25519Key,
  ) {
    this.publicKey = key.publicKey;
  }
  sign(digest: Uint8Array): Uint8Array {
    return this.key.sign(digest);
  }
}
