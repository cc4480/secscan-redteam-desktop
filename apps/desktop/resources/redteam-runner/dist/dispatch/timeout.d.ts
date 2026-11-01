/**
 * Tool-timeout contract (Q-TOOLTIMEOUT) — the runner-side port of the
 * Cordis timeout-policy contract (packages/guard/timeout-policy). One
 * code, TOOL_TIMEOUT, classifies a tool call that did not finish within
 * its budget; it rides on the result's errorCode (dispatch/types.ts) so
 * mechanical consumers — auto-halt classification, item verdicts — key
 * on the code, never on result text. The runner dispatches through its
 * own router rather than the Cordis tools/execute waterfall, so the
 * code and the result semantics are ported here; the plugin itself is
 * not loaded in the runner process.
 */
import { type DispatchResult } from './types.js';
/** Structured error code for a tool call that exceeded its time budget. */
export declare const TOOL_TIMEOUT = "TOOL_TIMEOUT";
/**
 * Build the canonical timed-out dispatch result. The upstream message
 * body ("tool call timed out after Xms") is preserved verbatim inside
 * the runner's ALL-CAPS prefix convention (the DENIED/HALTED/ABORTED
 * family); the typed identity rides in errorCode. `ok: false` — the
 * call did not succeed, so it consumes no exploit-step budget and
 * counts as a failure (never clean) for the duplicate guard.
 *
 * @param opts.toolName - the tool call's name, named in the message.
 * @param opts.timeoutMs - the budget that fired, in milliseconds.
 * @param opts.target - the call's target host, when it has one.
 * @returns the timed-out result to return in place of the tool's own.
 */
export declare function toolTimeoutResult(opts: {
    toolName: string;
    timeoutMs: number;
    target?: string;
}): DispatchResult;
