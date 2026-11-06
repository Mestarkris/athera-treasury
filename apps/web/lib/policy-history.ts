import "server-only";
import { K, policyDirtyFromGit, policyHistoryFromGit, type PolicyCommit } from "@athera/store";
import { ROOT, agentMeta, store } from "./ledger";

export type { PolicyCommit };

/** config.yaml history: from git locally; hosted, as the worker last published it. */
export async function policyHistory(): Promise<PolicyCommit[]> {
  if (store) return (await store.getJson<PolicyCommit[]>(K.policyHistory)) ?? [];
  return policyHistoryFromGit(ROOT);
}

/** True if config.yaml has uncommitted edits on the agent's machine. */
export async function policyDirty(): Promise<boolean> {
  if (store) return Boolean((await agentMeta())?.policy_dirty);
  return policyDirtyFromGit(ROOT);
}
