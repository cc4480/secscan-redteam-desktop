/**
 * Shared role-prompt building blocks: PromptContext, the ROE block, the
 * ATT&CK catalog renderer, and the red/black mode briefs. One role prompt
 * per sibling file.
 */
import type { TargetId } from "../targets.js";
import type { EngagementMode, RulesOfEngagement } from "../types.js";
export interface PromptContext {
    mode: EngagementMode;
    objective: string;
    target: string;
    scopeHosts: string[];
    roe: RulesOfEngagement;
    /** Full-battery unified engagement: selected target batteries drive the plan. */
    fullBattery?: boolean;
    /** Subset of targets for a full-battery run; defaults to all four. */
    targets?: TargetId[];
    /**
     * LOCAL SANDBOX MODE ONLY. True only when the gate's allowLocalSandbox
     * bypass actually fired (i.e. the target is loopback/private — see
     * gate.ts/prober.ts). Relaxes the exploiter's non-destructive discipline
     * so it may complete mutations/state changes it would otherwise stop
     * short of, since a local sandbox target is disposable. Never changes
     * technique exclusions (T1499 stays excluded) or scope enforcement.
     */
    localSandbox?: boolean;
}
/** "SecScan (SS-*) + Windows host + AD (WS-*)" style list for prompt text. */
export declare function targetListText(targets: TargetId[]): string;
export declare function attackCatalog(): string;
export declare function roeBlock(ctx: PromptContext): string;
export declare const MODE_BRIEF: Record<EngagementMode, string>;
