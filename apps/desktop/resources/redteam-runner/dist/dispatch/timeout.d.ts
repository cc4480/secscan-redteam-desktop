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
/** Env override for the per-call dispatch budget, in milliseconds. */
export declare const CALL_TIMEOUT_ENV = "REDTEAM_CALL_TIMEOUT_MS";
/**
 * Default per-call dispatch budget: 20 minutes. This is a BACKSTOP, not the
 * primary bound — every executor already carries its own tighter timer
 * (host-exec 30s, msf 120s, nuclei ~135s, nmap 300s, xtool up to 900s), and
 * the default sits above all of them so a legitimate long tool is never cut
 * by the dispatcher. Its job is the call whose executor never settles at
 * all: without it that call holds its dispatch slot forever.
 */
export declare const DEFAULT_CALL_TIMEOUT_MS = 1200000;
/**
 * The per-call budget in force: {@link CALL_TIMEOUT_ENV} when it holds an
 * integer in [1, 3_600_000], otherwise {@link DEFAULT_CALL_TIMEOUT_MS}.
 * @param env - environment to read; injectable for tests.
 * @returns the budget in milliseconds.
 */
export declare function resolveCallTimeoutMs(env?: NodeJS.ProcessEnv): number;
/**
 * Arm a per-call controller: it aborts when `timeoutMs` elapses. Returns the
 * disarm function — the caller MUST call it when the call settles first, so
 * a finished call is never aborted late by a leaked timer.
 * @param ctrl - the call's controller (created in dispatch/router.ts and
 * passed down to the handlers, whose executors kill the child on abort).
 * @param timeoutMs - the call's budget, from {@link resolveCallTimeoutMs}.
 * @returns a function that clears the timer.
 */
export declare function armCallTimeout(ctrl: AbortController, timeoutMs: number): () => void;
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
