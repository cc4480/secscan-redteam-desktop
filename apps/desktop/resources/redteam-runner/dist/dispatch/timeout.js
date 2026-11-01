/** Structured error code for a tool call that exceeded its time budget. */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT';
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
export function toolTimeoutResult(opts) {
    return {
        result: `TIMEOUT: tool call timed out after ${opts.timeoutMs}ms — ${opts.toolName} did not finish ` +
            'within its budget. The tool may still be completing in the background; its late ' +
            'result is discarded. This is a tool timeout, not a target response.',
        ok: false,
        errorCode: TOOL_TIMEOUT,
        ...(opts.target ? { target: opts.target } : {}),
    };
}
//# sourceMappingURL=timeout.js.map