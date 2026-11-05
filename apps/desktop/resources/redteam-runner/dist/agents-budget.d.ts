/**
 * The agent loop's stop conditions and tool-call repair steering.
 *
 * Extracted from agents.ts in a structural split (no file under src/ may
 * exceed 300 lines). Moved verbatim: the blackout wait, the ONE permitted
 * SAFETY halt (three consecutive 5xx), the BUDGET stop that closes a phase
 * without halting, the default repair cap, and the repair prompt builder.
 * No condition, threshold or message string changed in the move; agents.ts
 * re-exports DEFAULT_REPAIR_CAP so every existing importer still resolves.
 */
import { type JsonSchemaTool, type ToolCallRequest } from '@secscan/redteam-llm-router';
import { type Ctx } from './context.js';
import { type EngagementPhase } from './types.js';
import { type DispatchResult } from './dispatch/types.js';
export declare function respectBlackout(ctx: Ctx, phase: EngagementPhase): Promise<void>;
/**
 * Q-NOHALT — a SAFETY halt, and the only cap that may still throw.
 *
 * Three consecutive 5xx is evidence of production impact: continuing would
 * keep hitting a service that is already failing, so the run stops
 * deliberately and the report says why. Nothing else in this module halts.
 */
export declare function safetyHalt(ctx: Ctx): string | null;
/**
 * Q-NOHALT — a BUDGET stop, not a halt.
 *
 * The action and duration caps are configured limits, not target conditions.
 * Hitting one means the engagement ran out of its allowance, so the phase
 * closes with the work already done and the battery records what is still
 * pending — the run finishes and reports. Throwing HaltError here used to
 * discard a whole engagement because a clock or a counter expired.
 */
export declare function budgetExhausted(ctx: Ctx): string | null;
/** Default tool-call repair budget per agentLoop invocation (RC Item 6). */
export declare const DEFAULT_REPAIR_CAP = 3;
/**
 * The repair steering for one tagged result: the defect, the tool's
 * schema, and the original arguments, per the Item 6 design. The model
 * answers with exactly one corrected call; the name may change only for
 * an unknown-tool defect, and then only to an offered tool.
 */
export declare function buildRepairPrompt(call: ToolCallRequest, d: DispatchResult, tools: JsonSchemaTool[], spent: number, cap: number): string;
