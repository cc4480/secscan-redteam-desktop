/**
 * Tool-dispatch result type (v0.19.0 refactor — extracted from dispatch.ts).
 */
export interface DispatchResult {
  result: string
  attackId?: string
  target?: string
  opsec?: string
  /** True when the call actually succeeded. Absent for handlers that do not
   * distinguish; the router falls back to a string heuristic in that case. */
  ok?: boolean
  /** Structured error code for mechanically-classified failures (e.g.
   * TOOL_TIMEOUT from dispatch/timeout.ts). Consumers key on this code,
   * never on result text. Absent for ordinary results. */
  errorCode?: string
}

