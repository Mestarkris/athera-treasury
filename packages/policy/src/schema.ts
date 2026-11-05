import { z } from "zod";

/** NEAR account ID rules (lowercase, 2–64 chars, `.`-separated parts). */
export const AccountId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "not a valid NEAR account ID");
export type AccountId = z.infer<typeof AccountId>;

/** Multi-token ID as used by intents.near, e.g. `nep141:wrap.near`. */
export const TokenId = z.string().regex(/^nep(141|171|245):[a-z0-9._:-]+$/, "not a token ID");
export type TokenId = z.infer<typeof TokenId>;

/** A non-negative decimal amount written in whole tokens, e.g. "0.05". */
export const DecimalAmount = z.string().regex(/^\d+(\.\d+)?$/, "not a decimal amount");

const PerAsset = <T extends z.ZodType>(value: T) => z.record(TokenId, value);

export const AgentRole = z.enum(["treasury", "accounting", "procurement", "sales"]);
export type AgentRole = z.infer<typeof AgentRole>;

export const ProposalKind = z.enum([
  "transfer",
  "fee",
  "revenue_split",
  "vendor_payment",
  "inference_spend",
]);
export type ProposalKind = z.infer<typeof ProposalKind>;

export const PolicyConfigSchema = z
  .object({
    version: z.number().int().positive(),
    network: z.enum(["mainnet", "testnet"]),
    verifier: AccountId,
    kill_switch: z.boolean(),
    assets: z
      .array(
        z.object({
          id: TokenId,
          symbol: z.string().min(1),
          decimals: z.number().int().min(0).max(36),
        }),
      )
      .min(1),
    approved: z.object({
      chains: z.array(z.string().min(1)).min(1),
      assets: z.array(TokenId).min(1),
      protocols: z.array(AccountId).min(1),
    }),
    accounts: z.object({ treasury: AccountId, revenue: AccountId }),
    limits: z.object({
      inference_spend_per_day_usd: DecimalAmount,
      capital_movement: PerAsset(z.object({ per_tx: DecimalAmount, per_day: DecimalAmount })),
    }),
    risk: z.object({
      max_drawdown_pct: z.number().min(0).max(100),
      min_reserve: PerAsset(DecimalAmount),
    }),
    fees: z.object({
      fee_bps: z.number().int().min(0).max(10_000),
      min_fee: PerAsset(DecimalAmount),
    }),
    revenue_split: z
      .array(z.object({ account: AccountId, label: z.string().min(1), pct: z.number().int().min(1).max(100) }))
      .min(1),
    counterparties: z.array(
      z.object({ account: AccountId, role: z.enum(["vendor", "client"]), label: z.string().min(1) }),
    ),
    agents: z.record(AgentRole, z.array(ProposalKind)),
  })
  .strict()
  .superRefine((c, ctx) => {
    const total = c.revenue_split.reduce((s, r) => s + r.pct, 0);
    if (total !== 100) {
      ctx.addIssue({ code: "custom", path: ["revenue_split"], message: `percentages sum to ${total}, not 100` });
    }
    const known = new Set(c.assets.map((a) => a.id));
    for (const a of c.approved.assets) {
      if (!known.has(a)) ctx.addIssue({ code: "custom", path: ["approved", "assets"], message: `${a} has no entry in assets` });
      if (!c.limits.capital_movement[a]) {
        ctx.addIssue({ code: "custom", path: ["limits", "capital_movement"], message: `${a} has no movement limits` });
      }
    }
    if (!c.approved.protocols.includes(c.verifier)) {
      ctx.addIssue({ code: "custom", path: ["verifier"], message: "verifier must be an approved protocol" });
    }
  });

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

/** One value movement inside the verifier. `amount` is in base units (integer string). */
export const TransferLeg = z.object({
  to: AccountId,
  asset: TokenId,
  amount: z.string().regex(/^\d+$/, "base-unit integer"),
});
export type TransferLeg = z.infer<typeof TransferLeg>;

/**
 * Agent identity. Internal roles are fixed; external Swarm-for-Hire agents are
 * `swarm:<name>` and are untrusted: they are authorized for nothing.
 */
export const AgentId = z.union([AgentRole, z.string().regex(/^swarm:[a-z0-9-]{1,32}$/)]);
export type AgentId = z.infer<typeof AgentId>;

export const ProposalSchema = z
  .object({
    id: z.string().min(1),
    kind: ProposalKind,
    agent: AgentId,
    chain: z.string().min(1),
    protocol: AccountId,
    from: AccountId,
    legs: z.array(TransferLeg),
    /** For fee / revenue_split: the upstream settled amount this is derived from. */
    basis: z.object({ ref: z.string().min(1), asset: TokenId, amount: z.string().regex(/^\d+$/) }).optional(),
    /** For inference_spend: cost in micro-USD. */
    inference_usd_micros: z.string().regex(/^\d+$/).optional(),
    reason: z.string().min(1),
    created_at: z.string().datetime(),
  })
  .strict();
export type Proposal = z.infer<typeof ProposalSchema>;
