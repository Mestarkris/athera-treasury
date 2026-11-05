import { base64 } from "@scure/base";
import type { SignedNep413Json } from "./intents/nep413.ts";
import type { FinalTxResult, NearRpc } from "./near/rpc.ts";

/** Everything Settlement needs from the network. Real impl: `NearChain`; tests: a fake. */
export interface Chain {
  currentSalt(verifier: string): Promise<string>;
  simulate(verifier: string, signed: SignedNep413Json[]): Promise<unknown>;
  accessKeyNonce(accountId: string, publicKey: string): Promise<{ nonce: bigint; blockHash: string }>;
  broadcast(signedTxBase64: string): Promise<void>;
  txStatus(txHash: string, senderId: string): Promise<FinalTxResult>;
  blockHeight(blockHash: string): Promise<number>;
}

export class NearChain implements Chain {
  constructor(private readonly rpc: NearRpc) {}

  currentSalt(verifier: string): Promise<string> {
    return this.rpc.view<string>(verifier, "current_salt", {});
  }

  simulate(verifier: string, signed: SignedNep413Json[]): Promise<unknown> {
    return this.rpc.view(verifier, "simulate_intents", { signed });
  }

  async accessKeyNonce(accountId: string, publicKey: string) {
    const k = await this.rpc.accessKey(accountId, publicKey);
    return { nonce: BigInt(k.nonce), blockHash: k.block_hash };
  }

  async broadcast(signedTxBase64: string): Promise<void> {
    // INCLUDED: returns once the tx is in a block; tracking waits for FINAL separately.
    await this.rpc.sendTx(signedTxBase64, "INCLUDED");
  }

  txStatus(txHash: string, senderId: string): Promise<FinalTxResult> {
    return this.rpc.txStatus(txHash, senderId, "FINAL");
  }

  async blockHeight(blockHash: string): Promise<number> {
    return (await this.rpc.block({ block_id: blockHash })).header.height;
  }
}

export const decodeBase64Json = (b64: string): unknown => JSON.parse(new TextDecoder().decode(base64.decode(b64)));
