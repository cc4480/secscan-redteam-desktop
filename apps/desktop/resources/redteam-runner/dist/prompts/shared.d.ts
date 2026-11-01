/**
 * Shared role-prompt building blocks: PromptContext, the ROE block, the
 * ATT&CK catalog renderer, and the red/black mode briefs. One role prompt
 * per sibling file.
 */
import type { VerifiedEngagementRecord } from '@secscan/redteam-fleet-skills';
import type { TargetId } from '../targets.js';
import type { EngagementMode, RulesOfEngagement } from '../types.js';
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
    /**
     * TEST MODE ONLY (REDTEAM_TEST_MODE, operator order). True when the
     * engagement runs with the mechanical restraints bypassed for testing
     * (see ResolvedRunnerConfig.testMode). roeBlock states the posture to
     * the fleet; the operator ROE exclusions still bind. Never widens scope.
     */
    testMode?: boolean;
    /**
     * Q-MEMTIER: the rendered recall start pack for this engagement
     * (agents.ts promptCtx reads it from the memory state). Absent when
     * no memory was recalled; memoryBlock renders nothing then.
     */
    memoryBrief?: string;
    /**
     * Phase 2 W3: the fleet prompt-assembly input (prompts/fleet-assembly.ts).
     * agents.ts promptCtx sets it from the AUTHORIZE phase's stamped record
     * (Ctx.verificationProof / verifiedAt / verifiedScope) on every live
     * run, and the role prompts then assemble through
     * @secscan/redteam-fleet-skills (master → soul → engagement injection →
     * knobs → seat text → skills index → phase skill bodies). Absent in
     * engagement-independent contexts (the agent-docs canonical context,
     * unit fixtures): the role prompts render their historical text
     * unchanged there.
     */
    fleet?: {
        /** The verified engagement record for the injection block. */
        record: VerifiedEngagementRecord;
        /** Fleet-wide CHARTER knob text (Prompt Pack §4), when a source exists. */
        charterKnobs?: string;
        /** Per-engagement ENGAGEMENT knob text; wins over the charter text. */
        engagementKnobs?: string;
    };
}
/** "SecScan (SS-*) + Windows host + AD (WS-*)" style list for prompt text. */
export declare function targetListText(targets: TargetId[]): string;
export declare function attackCatalog(): string;
export declare function roeBlock(ctx: PromptContext): string;
/**
 * Q-MEMTIER memory block: the recall start pack, rendered into the
 * coordinator and recon system prompts immediately after the ROE block.
 * The pack text reaches the prompt only through promptCtx, which
 * agentLoop journals into steps.jsonl (model-visible ⟺ logged). An
 * absent brief renders as the empty string, so runs without memory
 * produce byte-identical prompts.
 */
export declare function memoryBlock(ctx: PromptContext): string;
export declare const MODE_BRIEF: Record<EngagementMode, string>;
/** The standing mandate, injected into every role: novelty over convention.
 *  The old attacks are dead; we are paid for the one the target has never seen. */
export declare function creativeDoctrine(): string;
