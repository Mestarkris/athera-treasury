// STUB agents. Present only to show they go through the same policy engine.
// They are sequential, deterministic, and never run in the demo loop.
import type { PolicyConfig, Proposal } from "@athera/policy";

export const STUB = "STUB" as const;

export class ProcurementAgentStub {
  readonly id = "procurement" as const;
  readonly label = STUB;
  constructor(private readonly config: Readonly<PolicyConfig>) {}

  /**
   * Swarm-for-Hire: an external agent's output is untrusted. Procurement may only turn an
   * approved vendor's invoice into a vendor_payment proposal; the policy engine decides.
   */
  proposeVendorPayment(proposalId: string, vendor: string, asset: string, amount: string, reason: string, now = new Date()): Proposal {
    return {
      id: proposalId,
      kind: "vendor_payment",
      agent: this.id,
      chain: "near",
      protocol: this.config.verifier,
      from: this.config.accounts.treasury,
      legs: [{ to: vendor, asset, amount }],
      reason,
      created_at: now.toISOString(),
    };
  }
}

export class SalesAgentStub {
  readonly id = "sales" as const;
  readonly label = STUB;
}
