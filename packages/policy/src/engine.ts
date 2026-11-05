import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { hashJson, sha256Hex } from "./canonical.ts";
import { evaluateRules, fmt, type PolicyState, type RuleResult } from "./rules.ts";

import { PolicyConfigSchema, ProposalSchema, type PolicyConfig, type Proposal } from "./schema.ts";

export interface PolicyRef {
  readonly version: number;
  /** SHA-256 (hex) of the exact config.yaml bytes. */
  readonly hash: string;
}

interface CheckBase {
  readonly policy: PolicyRef;
  readonly proposalId: string;
  /** SHA-256 of the canonical proposal JSON. Settlement re-derives and compares it. */
  readonly proposalHash: string;
  readonly rules: readonly RuleResult[];
  readonly checkedAt: string;
  /** Plain one-line verdict, e.g. "Blocked: … Policy v1 · a1f9c2." */
  readonly summary: string;
}

export interface BlockedPolicyCheck extends CheckBase {
  readonly result: "block";
}

declare const passedBrand: unique symbol;
/**
 * A check that passed. Only `PolicyEngine.validate` can create one: the brand makes casts
 * fail at compile time, and `isMintedCheck` rejects forged objects at run time.
 */
export interface PassedPolicyCheck extends CheckBase {
  readonly result: "pass";
  readonly proposal: Proposal;
  readonly [passedBrand]: true;
}

export type PolicyCheck = PassedPolicyCheck | BlockedPolicyCheck;

const minted = new WeakSet<object>();

/** True only for pass checks created by a PolicyEngine in this process. */
export function isMintedCheck(check: unknown): check is PassedPolicyCheck {
  return typeof check === "object" && check !== null && minted.has(check);
}

export const shortHash = (h: string) => h.slice(0, 6);

export class PolicyEngine {
  readonly config: PolicyConfig;
  readonly ref: PolicyRef;
  readonly source: string;

  private constructor(source: string, config: PolicyConfig) {
    this.source = source;
    this.config = config;
    this.ref = Object.freeze({ version: config.version, hash: sha256Hex(source) });
  }

  /** Parse and validate config.yaml. Throws with every schema issue if invalid. */
  static fromSource(source: string): PolicyEngine {
    const raw: unknown = parseYaml(source);
    const parsed = PolicyConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
      throw new Error(`config.yaml is invalid:\n${issues}`);
    }
    return new PolicyEngine(source, parsed.data);
  }

  static load(path: string): PolicyEngine {
    return PolicyEngine.fromSource(readFileSync(path, "utf8"));
  }

  /**
   * Validate an untrusted proposal against policy and current state.
   * Never throws for bad input; malformed proposals are blocked.
   */
  validate(input: unknown, state: PolicyState): PolicyCheck {
    const checkedAt = new Date().toISOString();
    const tag = `Policy v${this.ref.version} · ${shortHash(this.ref.hash)}.`;
    const parsed = ProposalSchema.safeParse(input);

    if (!parsed.success) {
      const id = typeof input === "object" && input && "id" in input ? String((input as { id: unknown }).id) : "unknown";
      const msg = parsed.error.issues[0]?.message ?? "malformed";
      return Object.freeze({
        result: "block",
        policy: this.ref,
        proposalId: id,
        proposalHash: hashJson(input ?? null),
        rules: [{ rule: "schema", status: "block", detail: `proposal is malformed: ${msg}` } satisfies RuleResult],
        checkedAt,
        summary: `Blocked: proposal is malformed (${msg}). ${tag}`,
      });
    }

    const p = parsed.data;
    const rules = evaluateRules(this.config, p, state);
    const firstBlock = rules.find((r) => r.status === "block");
    const base = {
      policy: this.ref,
      proposalId: p.id,
      proposalHash: hashJson(p),
      rules: Object.freeze(rules),
      checkedAt,
    };

    if (firstBlock) {
      return Object.freeze({ ...base, result: "block", summary: `Blocked: ${firstBlock.detail}. ${tag}` });
    }

    const moved = p.legs.map((l) => fmt(this.config, l.asset, BigInt(l.amount))).join(" + ");
    const check = Object.freeze({
      ...base,
      result: "pass",
      proposal: Object.freeze(structuredClone(p)),
      summary: `Passed: ${p.kind}${moved ? ` ${moved}` : ""} within all ${rules.filter((r) => r.status === "pass").length} applicable rules. ${tag}`,
    }) as PassedPolicyCheck;
    minted.add(check);
    return check;
  }
}
