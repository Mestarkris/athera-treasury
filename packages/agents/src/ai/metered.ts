import type { Ledger, LedgerAgent, LedgerEntry, LedgerEntryInput } from "@athera/ledger";
import { HaltError, formatUnits, type KillSwitch, type PolicyCheck, type PolicyEngine, type Proposal } from "@athera/policy";
import { deriveState } from "../state.ts";
import type { ChatMessage, ChatResult, NearAiClient } from "./nearai.ts";

export interface MeteredDeps {
  readonly policy: PolicyEngine;
  readonly ledger: Ledger;
  readonly killSwitch: KillSwitch;
  readonly ai: NearAiClient;
  /** Where entries go; defaults to `ledger.append` (the orchestrator passes its run logger). */
  readonly append?: (e: LedgerEntryInput) => LedgerEntry;
}

export type MeteredOutcome =
  | { kind: "ok"; result: ChatResult; costEntry: LedgerEntry; checkEntry: LedgerEntry }
  | { kind: "blocked"; check: PolicyCheck; checkEntry: LedgerEntry };

const usd = (m: bigint) => `$${formatUnits(m, 6)}`;

/**
 * Every AI call is an `inference_spend` proposal: its worst-case cost is checked against the
 * approved models, the per-call cap and today's budget before the call, and the billed cost is
 * written to the ledger after it. Nothing calls the model without passing the policy engine.
 */
export async function meteredChat(
  d: MeteredDeps,
  req: {
    runId: string;
    proposalId: string;
    agent: LedgerAgent & Proposal["agent"];
    purpose: string;
    model: string;
    messages: readonly ChatMessage[];
    maxTokens: number;
    json?: boolean;
    upstream?: readonly string[];
  },
): Promise<MeteredOutcome> {
  const ks = d.killSwitch.state();
  if (ks.engaged) throw new HaltError(`AI call (${req.purpose})`, ks.reason ?? "kill switch engaged");

  const projected = await d.ai.projectCostMicros(req.model, req.messages, req.maxTokens);
  const cfg = d.policy.config;
  const proposal: Proposal = {
    id: req.proposalId,
    kind: "inference_spend",
    agent: req.agent,
    chain: "near",
    protocol: cfg.verifier,
    from: cfg.accounts.treasury,
    legs: [],
    inference_usd_micros: projected.toString(),
    model: req.model,
    reason: req.purpose,
    created_at: new Date().toISOString(),
  };
  const state = deriveState(d.ledger.all(), {}, ks.engaged);
  const check = d.policy.validate(proposal, state);
  const base = { run_id: req.runId, policy: d.policy.ref };
  const append = d.append ?? ((e: LedgerEntryInput) => d.ledger.append(e));
  const checkEntry = append({
    ...base,
    agent: "policy",
    type: "policy_check",
    result: check.result,
    summary: check.summary,
    refs: { proposal_id: proposal.id },
    ...(req.upstream ? { upstream: req.upstream } : {}),
    payload: { rules: check.rules, proposal, proposed_by: req.agent },
  });
  if (check.result === "block") return { kind: "blocked", check, checkEntry };

  const result = await d.ai.chat({ model: req.model, messages: req.messages, maxTokens: req.maxTokens, ...(req.json ? { json: true } : {}) });
  const costEntry = append({
    ...base,
    agent: req.agent,
    type: "cost",
    result: "confirmed",
    summary: `AI call for ${req.purpose}: ${result.promptTokens}+${result.completionTokens} tokens on ${req.model}, ${usd(result.costMicros)} (checked at most ${usd(projected)}).`,
    refs: { proposal_id: proposal.id },
    upstream: [checkEntry.id],
    payload: {
      provider: cfg.inference?.provider ?? "unconfigured",
      model: req.model,
      usd_micros: result.costMicros.toString(),
      projected_usd_micros: projected.toString(),
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
    },
  });
  return { kind: "ok", result, costEntry, checkEntry };
}
