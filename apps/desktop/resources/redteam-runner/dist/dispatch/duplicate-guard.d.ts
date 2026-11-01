import { type ActorRole, type EngagementPhase } from '../types.js';
import { type Ctx } from '../context.js';
import { type ToolCallRequest } from '@secscan/redteam-llm-router';
import { type DispatchResult } from './types.js';
/**
 * Per-tool argument keys whose variation cannot change what the target
 * receives (timeout, delay/jitter, retry knobs, output verbosity). A
 * key may be listed ONLY if varying it cannot change the request the
 * target receives — never a URL/path/query, method, body, port, scheme,
 * or a header that is itself the probe. Entries are added per tool
 * only with the handler owner's review. EMPTY BY DEFAULT: a tool with
 * no entry gets nearKey === toolCallKey, so the near-duplicate rule
 * cannot fire for it and behavior is literally today's.
 */
export declare const NEAR_DUP_IGNORED_KEYS: Readonly<Record<string, readonly string[]>>;
/** Identity of a call itself: tool name + canonical arguments, hashed. */
export declare function toolCallKey(call: ToolCallRequest): string;
/**
 * Near-identity of a call: tool name + canonical arguments with the
 * tool's listed non-semantic keys removed. Reuses `canonical`, so
 * key-order normalization is shared with the exact key. A tool with no
 * NEAR_DUP_IGNORED_KEYS entry gets nearKey === toolCallKey.
 */
export declare function nearKey(call: ToolCallRequest): string;
/**
 * Refusal for an identical repeat call, or undefined when the call may
 * execute. Only calls carrying a target host are guarded; `host`
 * undefined means the tool generates no target traffic.
 */
export declare function duplicateRefusal(ctx: Ctx, role: ActorRole, phase: EngagementPhase, call: ToolCallRequest, host: string | undefined): DispatchResult | undefined;
/**
 * Record an executed call's outcome so a later identical call can be
 * refused. Called only for calls that actually executed (post-hooks
 * result); gate denials never reach it and never seed the guard.
 */
export declare function recordCallOutcome(ctx: Ctx, role: ActorRole, phase: EngagementPhase, call: ToolCallRequest, host: string | undefined, d: DispatchResult): void;
