/**
 * Target-host resolution for tool calls (extracted from router.ts, which
 * sits at the 300-line file budget; router.ts re-exports RATE_LIMITED_TOOLS
 * so existing imports keep working).
 */
import { type ToolCallRequest } from "@secscan/redteam-llm-router";
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
export declare const RATE_LIMITED_TOOLS: Set<string>;
/** Best-effort target host for a tool call — undefined when the tool has no target traffic. */
export declare function toolTargetHost(call: ToolCallRequest): string | undefined;
