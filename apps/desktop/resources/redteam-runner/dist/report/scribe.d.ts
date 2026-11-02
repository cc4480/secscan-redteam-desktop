import { type Ctx } from "../context.js";
import { type ScribeDefect } from "../events.js";
export type { ScribeDefect } from "../events.js";
/** The Scribe's structured review verdict. */
export interface ScribeVerdict {
    verdict: "sign" | "reject";
    defects: ScribeDefect[];
}
/** The gate's outcome, for the caller's record. */
export interface ScribeGateOutcome {
    signed: boolean;
    /** Review cycles spent (0 when the gate did not run). */
    cycles: number;
    /** Why the set shipped unsigned, when it did. */
    reason?: "defects" | "scribe_unavailable" | "dry-run";
}
/**
 * The Scribe's reject/rewrite budget: the SCRIBE_MAX_CYCLES fleet knob
 * (default 2). The runner carries no charter/engagement knob files, so
 * the package defaults govern — the same sources the prompt assembly
 * resolves.
 *
 * @returns the maximum review cycles per completed close, at least 1
 */
export declare function scribeMaxCycles(): number;
/**
 * Parse the seat's verdict answer. Anything off-shape is null — the
 * caller records an unavailable seat, never a guessed verdict. A sign
 * carries no defects (a signed set with open defects is a contradiction);
 * a reject must name at least one well-formed defect to be actionable.
 *
 * @param text - the completion text
 * @returns the parsed verdict, or null when off-shape
 */
export declare function parseScribeVerdict(text: string): ScribeVerdict | null;
/**
 * The Scribe gate: review the closing deliverable set, sign it, or
 * reject-and-rewrite within the cycle budget, else ship it unsigned.
 * Runs only at a completed close; dry runs return immediately, and
 * halted/blocked ends never reach it (their close stays mechanical).
 *
 * @param ctx - the engagement context, after the report phase
 * @param opts - test seam: the regeneration step (defaults to
 *   {@link regenerateReport} over the engagement directory)
 * @returns the gate outcome; never throws except a rethrown HaltError
 */
export declare function scribeGate(ctx: Ctx, opts?: {
    regenerate?: (dir: string) => void;
}): Promise<ScribeGateOutcome>;
