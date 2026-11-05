import type { NearRpc } from "./near/rpc.ts";

export class CustodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustodyError";
  }
}

/**
 * Refuse to run unless the submitting key is a function-call key restricted to exactly
 * `execute_intents` on the verifier. A full-access key in the runtime is a hard error.
 */
export async function assertScopedSubmitKey(rpc: NearRpc, accountId: string, publicKey: string, verifier: string): Promise<{ allowance: string | null }> {
  const view = await rpc.accessKey(accountId, publicKey).catch((e: unknown) => {
    throw new CustodyError(`key ${publicKey} is not an access key of ${accountId}: ${String(e)}`);
  });
  if (view.permission === "FullAccess") {
    throw new CustodyError(`refusing to run: ${publicKey} is a FULL-ACCESS key on ${accountId}. Use a function-call key scoped to ${verifier}.execute_intents.`);
  }
  const fc = view.permission.FunctionCall;
  if (fc.receiver_id !== verifier) throw new CustodyError(`function-call key must target ${verifier}, targets ${fc.receiver_id}`);
  if (fc.method_names.length !== 1 || fc.method_names[0] !== "execute_intents") {
    throw new CustodyError(`function-call key must allow only execute_intents, allows [${fc.method_names.join(", ") || "all methods"}]`);
  }
  return { allowance: fc.allowance };
}

/** The intent-signing key must be registered for the account inside the verifier. */
export async function assertIntentKeyRegistered(rpc: NearRpc, verifier: string, accountId: string, publicKey: string): Promise<void> {
  const ok = await rpc.view<boolean>(verifier, "has_public_key", { account_id: accountId, public_key: publicKey });
  if (!ok) throw new CustodyError(`${publicKey} is not registered for ${accountId} in ${verifier} (call add_public_key once from that account)`);
}
