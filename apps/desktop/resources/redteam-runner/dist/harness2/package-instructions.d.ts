/**
 * Harness2 package section 6 - constraints restated + the required editor reply
 * format (H2-P2 spec sections 6 and 10).
 *
 * Section 6 restates, verbatim, the four standing constraints of the tuning
 * cycle: the guardrails are PINNED, the probe is k=1, the cycle is propose-only,
 * and the cycle has a token budget. It also states the editor reply syntax the
 * section-10 parser accepts (one @@PROPOSAL block, a @@RATIONALE, an
 * @@EXPECTED-EFFECT, at least one @@SUPPORTING-EVIDENCE block and one or more
 * @@FILE blocks carrying FULL file contents, never a diff).
 */
import type { PackageConstraints } from "./package.js";
/** Budget assumed when the operator sets none. */
export declare const DEFAULT_PROBE_TOKEN_BUDGET = 200000;
/** Operator override for the per-cycle probe token budget. */
export declare const PROBE_TOKEN_BUDGET_ENV = "DSH_HARNESS2_PROBE_TOKEN_BUDGET";
/** The reply syntax the editor must use; parsed by ./package-reply.ts. */
export declare const REPLY_FORMAT_DOC: string;
/** Read the per-cycle probe token budget (operator override wins; must be positive). */
export declare function resolveProbeTokenBudget(environment?: NodeJS.ProcessEnv): number;
/** Build the section-6 constraint block for one package. */
export declare function buildConstraints(guardrailPaths: readonly string[], environment?: NodeJS.ProcessEnv): PackageConstraints;
/** Render section 6 (constraints restated + the required reply format). */
export declare function renderConstraintsSection(constraints: PackageConstraints): string[];
