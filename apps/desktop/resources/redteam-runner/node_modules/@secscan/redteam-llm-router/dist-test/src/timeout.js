/**
 * Completion-timeout policy for the LLM providers.
 *
 * A hanging provider call must never freeze the agent: this wraps the caller's
 * abort signal with a hard deadline at the fetch boundary. The resulting
 * AbortError is classified as `timeout` (retryable) by classifier.ts, so the
 * resilience layer retries it like any other transient failure — distinct from
 * a CALLER abort (engagement cancellation), which is never retried and must
 * stay untouched on `options.signal`.
 */
/** 5 minutes: reasoning models can take a while on a single completion. */
const DEFAULT_COMPLETION_TIMEOUT_MS = 300_000;
/** Resolve the completion deadline from REDTEAM_LLM_TIMEOUT_MS (ms), else default. */
export function resolveCompletionTimeoutMs(env = process.env) {
    const raw = Number(env['REDTEAM_LLM_TIMEOUT_MS']);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COMPLETION_TIMEOUT_MS;
}
/** Combine the caller's signal with a hard deadline. Returns undefined only when
 *  there is neither a caller signal nor a positive timeout. */
export function completionSignal(signal, timeoutMs) {
    if (timeoutMs <= 0)
        return signal;
    const parts = [AbortSignal.timeout(timeoutMs)];
    if (signal)
        parts.push(signal);
    return AbortSignal.any(parts);
}
