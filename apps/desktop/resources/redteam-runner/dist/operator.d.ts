/**
 * Operator dispatch — the executor tools with NO live engagement (v0.31.0).
 *
 * Carlos's order (2026-11-01): the executor bridges (http_probe, msf_exec,
 * nmap_exec, nuclei_exec, ssh_exec, …) must not be gated on a running
 * engagement — "I don't want anything gated, especially those tools." The
 * gated design routed every MCP executor call through a live engagement's
 * context, so with nothing running the tools were dead. This module is the
 * other path: a call that names NO engagement executes directly, as the
 * operator's own call, against the target named in its arguments.
 *
 * The posture is deliberate and narrow:
 *
 *   - Dispatch goes through dispatchToolInner — the handler chain itself —
 *     NOT through dispatchTool's engagement safety wrapper. There is no
 *     tier refusal, no scope refusal, no auto-halt, no lockout interlock,
 *     no variant cap and no ESTOP check on this path, because there is no
 *     engagement for those mechanisms to belong to.
 *   - What the handlers themselves require is seated per call: the target
 *     host resolved from the call's arguments becomes the context's scope
 *     (hosts / verifiedScope / prober scope), so the per-handler target
 *     checks validate the operator's own named target and nothing else.
 *   - The context posture is Tier 2 with production confirmed: the operator
 *     placing the call IS the confirmation. Handler-level checks that read
 *     the tier (e.g. nmap profile minTier) see the operator's full tier.
 *   - Two things are kept, because they are not gates: the per-host rate
 *     limiter still paces calls (it delays; it never denies), and every
 *     call is written to the operator context's event log (audit) — a call
 *     that leaves no record did not happen.
 *
 * Calls are serialized through a single chain: the context is shared and
 * its scope is seated per call, so two operator calls never interleave
 * their seating. The operator is one person at one console; the queue is
 * the honest shape.
 *
 * A call that names an engagement id never reaches this module — the MCP
 * surface routes it to dispatchLiveTool, and a non-live id fails there
 * with an honest "not running" error rather than falling back to here.
 * Implicit retargeting is the one part of the old design that stays.
 */
import { type Ctx, type RunnerDeps } from "./context.js";
import type { DispatchResult } from "./dispatch/types.js";
/** The synthetic engagement id the operator context logs under. */
export declare const OPERATOR_ID = "operator";
export interface OperatorDispatcher {
    readonly ctx: Ctx;
    dispatch(name: string, args: Record<string, unknown>): Promise<DispatchResult>;
}
export interface OperatorOptions {
    /** Injectable transports/executors (tests); defaults are the real ones. */
    deps?: RunnerDeps;
    /** Override for the resolved engagements root (tests). */
    engagementsDir?: string;
    /** Environment to resolve config from (tests). Defaults to process.env. */
    env?: NodeJS.ProcessEnv;
}
/**
 * Build the operator context: a real Ctx, shaped like an engagement's but
 * belonging to no engagement. Constructed once per dispatcher and reused —
 * the rate limiter's pacing state and the event log are the point of the
 * reuse.
 */
export declare function buildOperatorCtx(opts?: OperatorOptions): Ctx;
/**
 * Create an operator dispatcher over a freshly built context. Operator
 * dispatches are serialized: the context is shared and its scope is seated
 * per call, so calls run one at a time, in arrival order.
 */
export declare function createOperatorDispatcher(opts?: OperatorOptions): OperatorDispatcher;
/**
 * Dispatch one executor tool call with no engagement, through the
 * process-wide operator dispatcher (built lazily on first use).
 */
export declare function dispatchOperatorTool(name: string, args: Record<string, unknown>): Promise<DispatchResult>;
/**
 * Test seam: replace (or clear, with undefined) the process-wide operator
 * dispatcher so suites can run against fixture transports and a temp
 * engagements root instead of the real config.
 */
export declare function installOperatorDispatcher(dispatcher: OperatorDispatcher | undefined): void;
