// Treasury agent. Allowed: propose movements within current policy.
// Forbidden: signing, submitting intents, changing policy. This module therefore imports
// only types from @athera/policy and nothing from @athera/settlement (enforced by a test).
import type { PolicyConfig, Proposal } from "@athera/policy";

export interface TreasuryInstruction {
  readonly to: string;
  readonly asset: string;
  /** Base units. */
  readonly amount: string;
  readonly reason: string;
}

/**
 * Rule-based in the MVP: it turns an operator instruction into a proposal. It does not call
 * an LLM, so it records no inference cost.
 */
export class TreasuryAgent {
  readonly id = "treasury" as const;
  constructor(private readonly config: Readonly<PolicyConfig>) {}

  propose(proposalId: string, i: TreasuryInstruction, now = new Date()): Proposal {
    return {
      id: proposalId,
      kind: "transfer",
      agent: this.id,
      chain: "near",
      protocol: this.config.verifier,
      from: this.config.accounts.treasury,
      legs: [{ to: i.to, asset: i.asset, amount: i.amount }],
      reason: i.reason,
      created_at: now.toISOString(),
    };
  }
}
