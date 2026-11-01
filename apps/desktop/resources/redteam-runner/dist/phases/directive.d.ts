import { type Ctx } from "../context.js";
import { type CoordinatorDirective } from "./tasks.js";
export declare function coordinatorDirective(ctx: Ctx, kind: "decompose" | "replan", context: string): Promise<CoordinatorDirective>;
/**
 * Condense a directive context for the single re-issue after a
 * content-policy rejection: the raw batch dump is what the provider
 * rejected, so the retry carries a structured summary instead — section
 * count and sizes, plus the head (and, for long sections, the tail) of
 * each section — from which the coordinator produces the same directive.
 *
 * @param kind - the directive kind being re-issued
 * @param context - the original, uncondensed directive context
 * @returns the condensed context for the re-issue call
 */
export declare function condenseDirectiveContext(kind: "decompose" | "replan", context: string): string;
/**
 * coordinatorDirective with the honest-close failure path (Q-HALT Item 4).
 *
 * A directive call that fails (e.g. the provider safety-rejects the re-plan
 * context) must not halt the engagement: the phase has completed work worth
 * reporting, and every other incompleteness in the phase closes honestly.
 * On success this returns the directive; on a HaltError it RETHROWS
 * untouched (deliberate stops — caps, blackout, consecutive-5xx — remain
 * engagement halts by design); on any other error it appends exactly one
 * directive_failed event carrying the provider cause (describeErrorCause —
 * the ResilienceError message alone is only the classifier's rule name)
 * and returns null, leaving the caller to close the phase with completed
 * work only. coordinatorDirective itself is unchanged.
 *
 * One containment step runs before the close (W2): when the failure is
 * classified content_policy, the directive is re-issued ONCE with a
 * condensed context (condenseDirectiveContext — a structured summary,
 * not the raw batch dump that was rejected). The re-issue's outcome is
 * final: success returns the directive, a HaltError rethrows, and any
 * other failure falls into the same honest close, whose single
 * directive_failed event carries that final error's cause.
 */
export declare function coordinatorDirectiveOrClose(ctx: Ctx, kind: "decompose" | "replan", context: string): Promise<CoordinatorDirective | null>;
