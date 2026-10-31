/**
 * Tool dispatcher: router + safety wrapper (v0.19.0 refactor — extracted from dispatch.ts).
 *
 * dispatchToolInner routes each tool call to its handler module (web, host,
 * msf, mcp, bookkeeping) in the original order. dispatchTool wraps it with
 * the v0.13.0 safety wrapper: rate limiting + per-target auto-halt +
 * autonomy-tier enforcement, all mechanical.
 */
import { type ActorRole, type EngagementPhase } from '../types.js'
import { type Ctx } from '../context.js'
import { type ToolCallRequest } from '@secscan/redteam-llm-router'
import { type DispatchResult } from './types.js'
/**
 * Tools whose calls generate traffic against a target host. Tools without a
 * resolvable target host (shared-state tools, MCP read-only tools) skip the
 * limiter — they generate no target traffic.
 *
 * Exported so test/tool-family-consistency.test.ts can assert that every host
 * tool the runner exposes is actually rate-limited and auto-halt tracked. A
 * tool missing from this set fires real traffic with no limiter at all, which
 * is exactly the class of gap the nmap scope check fell into.
 */
export declare const RATE_LIMITED_TOOLS: Set<string>
/**
 * v0.24.0: mid-run tier changes. The operator may raise/lower the tier via
 * `redteam-runner escalate` or the UI; both rewrite tier.json in the
 * engagement dir (atomically). The dispatcher re-reads it before every tier
 * check so the new tier takes effect without restarting the engagement.
 * The change lands in the audit log — never silent. A missing or corrupt
 * file means "no change". Exported for tests; dispatchTool calls it.
 */
export declare function refreshTierFromDisk(ctx: Ctx, phase: EngagementPhase): void
/**
 * v0.25.0: cross-process kill switch. The UI cannot reach into a
 * CLI-launched engagement's process, so it writes abort.json into the
 * engagement dir; the dispatcher checks for it here on every dispatch
 * cycle. When the marker is found, the abort sequence is identical to the
 * in-process kill switch: set the flag, terminate every in-flight
 * execution via the registered controllers (shared ctx — covers parallel
 * tasks), count it for the safety manifest, log abort_engagement, consume
 * the marker (the audit event is the durable record), and throw HaltError
 * so the run unwinds to "halted". Exported for tests; dispatchTool calls
 * it. A missing or corrupt file means "no abort requested" — never a
 * crash, never a spurious abort.
 */
export declare function checkAbortSignal(ctx: Ctx, phase: EngagementPhase): void
export declare function dispatchTool(ctx: Ctx, role: ActorRole, phase: EngagementPhase, call: ToolCallRequest): Promise<DispatchResult>
