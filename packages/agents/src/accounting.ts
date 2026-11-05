// Accounting agent. Allowed: record events, propose fee collection and revenue-split intents
// per policy. Forbidden: moving client capital outside the fee rules. It only computes amounts
// with the policy's own formulas; the PolicyEngine still checks every proposal it makes.
import { expectedFee, expectedSplit, type PolicyConfig, type Proposal } from "@athera/policy";

export interface SettledBasis {
  /** Ledger id of the settlement this derives from. */
  readonly ref: string;
  readonly asset: string;
  readonly amount: string;
}

export class AccountingAgent {
  readonly id = "accounting" as const;
  constructor(private readonly config: Readonly<PolicyConfig>) {}

  proposeFee(proposalId: string, settled: SettledBasis, now = new Date()): Proposal {
    const fee = expectedFee(this.config, settled.asset, BigInt(settled.amount));
    return {
      id: proposalId,
      kind: "fee",
      agent: this.id,
      chain: "near",
      protocol: this.config.verifier,
      from: this.config.accounts.treasury,
      legs: [{ to: this.config.accounts.revenue, asset: settled.asset, amount: fee.toString() }],
      basis: settled,
      reason: `fee of ${this.config.fees.fee_bps} bps on settlement ${settled.ref}`,
      created_at: now.toISOString(),
    };
  }

  proposeSplit(proposalId: string, fee: SettledBasis, now = new Date()): Proposal {
    return {
      id: proposalId,
      kind: "revenue_split",
      agent: this.id,
      chain: "near",
      protocol: this.config.verifier,
      from: this.config.accounts.revenue,
      legs: expectedSplit(this.config, fee.asset, BigInt(fee.amount)),
      basis: fee,
      reason: `revenue split of fee ${fee.ref}`,
      created_at: now.toISOString(),
    };
  }
}
