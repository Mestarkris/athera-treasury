import { base58, base64 } from "@scure/base";
import type { Chain } from "../src/chain.ts";
import { nep413Prehash, type SignedNep413Json } from "../src/intents/nep413.ts";
import type { FinalTxResult } from "../src/near/rpc.ts";

/** In-memory verifier stand-in. Records every call so tests can assert what reached the network. */
export class FakeChain implements Chain {
  calls: string[] = [];
  simulated: SignedNep413Json[] = [];
  broadcasts: string[] = [];
  failTx = false;
  /** Run inside txStatus, e.g. to flip a kill switch while "waiting for finality". */
  onTrack?: (() => void) | undefined;

  async currentSalt() {
    this.calls.push("currentSalt");
    return "252812b3";
  }
  async simulate(_v: string, signed: SignedNep413Json[]) {
    this.calls.push("simulate");
    this.simulated.push(...signed);
    return { intents_executed: [] };
  }
  async accessKeyNonce() {
    this.calls.push("accessKeyNonce");
    return { nonce: 41n, blockHash: base58.encode(new Uint8Array(32).fill(7)) };
  }
  async broadcast(b64: string) {
    this.calls.push("broadcast");
    this.broadcasts.push(b64);
  }
  async txStatus(txHash: string, sender: string): Promise<FinalTxResult> {
    this.calls.push("txStatus");
    this.onTrack?.();
    const last = this.simulated.at(-1);
    if (!last) throw new Error("nothing simulated");
    const intentHash = base58.encode(
      nep413Prehash({ message: last.payload.message, nonce: base64.decode(last.payload.nonce), recipient: last.payload.recipient }),
    );
    const log = `EVENT_JSON:${JSON.stringify({ standard: "dip4", version: "0.3.0", event: "transfer", data: [{ intent_hash: intentHash, account_id: "x" }] })}`;
    return {
      status: this.failTx ? { Failure: { reason: "boom" } } : { SuccessValue: "" },
      transaction: { hash: txHash, signer_id: sender, receiver_id: "intents.near" },
      transaction_outcome: { id: txHash, block_hash: "B1", outcome: { logs: [], status: { SuccessReceiptId: "R1" }, executor_id: sender } },
      receipts_outcome: [{ id: "R1", block_hash: "B2", outcome: { logs: [log], status: { SuccessValue: "" }, executor_id: "intents.near" } }],
    };
  }
  async blockHeight() {
    this.calls.push("blockHeight");
    return 123_456;
  }
}
