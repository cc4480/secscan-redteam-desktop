/**
 * Tool-dispatch result type (v0.19.0 refactor — extracted from dispatch.ts).
 */
export interface DispatchResult {
    result: string;
    attackId?: string;
    target?: string;
    opsec?: string;
    /** True when the call actually succeeded. Absent for handlers that do not
     * distinguish; the router falls back to a string heuristic in that case. */
    ok?: boolean;
    /** Structured error code for mechanically-classified failures (e.g.
     * TOOL_TIMEOUT from dispatch/timeout.ts). Consumers key on this code,
     * never on result text. Absent for ordinary results. */
    errorCode?: string;
    /** Tool-call repair tag (runner corrections Item 6): set ONLY by
     * handlers on the closed list of call-shape defects (unknown tool;
     * unparseable URL; a missing required host/url argument; an unknown
     * profile; missing BOLA identities; an out-of-enum probe name) — a
     * malformed call the model can fix, never a policy denial. The value
     * names the defect. agentLoop spends one bounded repair exchange on a
     * tagged result; untagged results are never repaired. Absent = not
     * repairable. */
    repairable?: string;
}
