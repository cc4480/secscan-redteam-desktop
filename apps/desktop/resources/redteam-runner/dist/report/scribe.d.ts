import { type Ctx } from '../context.js';
export type { ScribeDefect } from '../events.js';
import { type ScribeGateOutcome } from './scribe-verdict.js';
export { parseScribeVerdict, scribeMaxCycles } from './scribe-verdict.js';
export type { ScribeGateOutcome, ScribeVerdict } from './scribe-verdict.js';
/**
 * The Scribe gate: review the closing deliverable set, sign it, or
 * reject-and-rewrite within the cycle budget, else ship it unsigned.
 * Runs only at a completed close; a dry run stamps the set UNSIGNED
 * (reason `dry-run`, no review) and returns, and halted/blocked ends
 * never reach it (their close stays mechanical).
 *
 * @param ctx - the engagement context, after the report phase
 * @param opts - test seam: the regeneration step (defaults to
 *   {@link regenerateReport} over the engagement directory)
 * @returns the gate outcome; never throws except a rethrown HaltError
 */
export declare function scribeGate(ctx: Ctx, opts?: {
    regenerate?: (dir: string) => void;
}): Promise<ScribeGateOutcome>;
