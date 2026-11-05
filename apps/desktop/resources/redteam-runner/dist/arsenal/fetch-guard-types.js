/**
 * Fetch-guard types and typed errors — extracted from `fetch-guard.ts` so
 * the parent module stays inside the runner's 300-line file budget. Same
 * public names, re-exported from the parent unchanged.
 */
/** The destination itself is refused by policy. Recorded against the collection. */
export class DestinationDeniedError extends Error {
    code = 'DESTINATION_DENIED';
    /** The URL being fetched at the hop that was denied. */
    url;
    reason;
    /** Redirect hop at which the denial occurred (0 = the original URL). */
    hop;
    /** Specifics safe to log: the offending address/range, scheme, or size. */
    detail;
    constructor(url, reason, hop, detail) {
        super(`destination denied (${reason}) at hop ${hop}: ${url}` +
            (detail === undefined ? '' : ` — ${detail}`));
        this.name = 'DestinationDeniedError';
        this.url = url;
        this.reason = reason;
        this.hop = hop;
        this.detail = detail;
    }
}
/** The destination was allowed but the fetch itself failed operationally. */
export class FetchFailedError extends Error {
    code = 'FETCH_FAILED';
    url;
    reason;
    hop;
    /** HTTP status, when the failure is a non-success response status. */
    status;
    constructor(url, reason, hop, status, cause) {
        super(`fetch failed (${reason}) at hop ${hop}: ${url}` +
            (status === undefined ? '' : ` — HTTP ${status}`), cause === undefined ? undefined : { cause });
        this.name = 'FetchFailedError';
        this.url = url;
        this.reason = reason;
        this.hop = hop;
        this.status = status;
    }
}
//# sourceMappingURL=fetch-guard-types.js.map