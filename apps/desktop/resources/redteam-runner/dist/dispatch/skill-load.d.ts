import type { ToolCallRequest } from '@secscan/redteam-llm-router';
import type { Ctx } from '../context.js';
import type { ActorRole, EngagementPhase } from '../types.js';
import type { DispatchResult } from './types.js';
export type SkillLoadResult = {
    ok: true;
    body: string;
} | {
    ok: false;
    error: string;
};
/**
 * Load one skill body by its index name (mechanical; unit-tested).
 *
 * @param name - the exact skill name from the fleet skills index, or
 *   undefined when the caller supplied none
 * @returns the full SKILL.md text, or a plain-language error (missing
 *   name, or the loader's own message naming the miss and listing the
 *   available skills)
 */
export declare function loadSkill(name: string | undefined): SkillLoadResult;
/**
 * Claim load_skill calls for the dispatch chain.
 *
 * @returns the skill body (or a plain-language error) as the tool
 *   result; null for every other tool name
 */
export declare function handleSkillLoadTools(_ctx: Ctx, _role: ActorRole, _phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>): Promise<DispatchResult | null>;
