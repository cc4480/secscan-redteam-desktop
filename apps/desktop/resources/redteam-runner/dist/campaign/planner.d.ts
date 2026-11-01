/**
 * Wave planner (Q-CAMPAIGN, scoping N4 / decisions D-3, D-4).
 *
 * One coordinator-model completion proposes the next wave: an aim and
 * a focus roster drawn from the kind's vector list. The output is
 * treated as untrusted structured data, exactly the way the workgraph
 * refiner's output is treated inside an engagement: parsed, validated
 * field by field, invalid entries dropped WITH the reason kept — and
 * if the reply cannot be read at all, the wave falls back to a
 * deterministic coverage-gap roster. A planner failure never becomes
 * an improvisation and never stops the campaign: the fallback is a
 * fixed matrix, and the reason it was used is recorded in the plan.
 *
 * The planner seat (D-4) is the coordinator completion, injected here
 * so tests run keyless and the CLI wires the real router.
 */
import type { CampaignKind } from './kinds.js';
import type { CampaignRecord } from './types.js';
/** One chat message handed to the injected coordinator completion. */
export interface PlannerMessage {
    role: 'system' | 'user';
    content: string;
}
/** The injected coordinator completion (production: the llm-router's
 *  completeForRole("coordinator", …); tests: a fake). Returns raw text. */
export type WavePlannerCompletion = (messages: PlannerMessage[]) => Promise<string>;
/** A roster entry the planner proposed that validation dropped. */
export interface DroppedPlannerEntry {
    /** What was dropped (the raw focus value, or "plan" for a whole-plan rejection). */
    item: string;
    /** Why it was dropped — recorded, never silent. */
    reason: string;
}
/** One wave's plan: what it aims at, what it focuses on, and its provenance. */
export interface WavePlan {
    waveIndex: number;
    /** One line: what this wave attacks and why now. */
    aim: string;
    /** Kind vector names this wave focuses (validated against the roster). */
    focusVectors: string[];
    /** The planner's (or fallback's) reasoning, kept with the plan. */
    rationale: string;
    /** Where the plan came from: the coordinator call, or the deterministic fallback. */
    source: 'coordinator' | 'fallback';
    /** Why the fallback was used, when it was. Absent for coordinator plans. */
    fallbackReason?: string;
    /** Planner entries validation dropped, with reasons. */
    dropped: DroppedPlannerEntry[];
    /** ISO timestamp of when the plan was produced. */
    plannedAt: string;
}
/** How many vectors one wave may focus — breadth beyond this is a second wave. */
export declare const MAX_FOCUS_VECTORS = 4;
/** How many vectors a fallback wave takes from the gap list. */
export declare const FALLBACK_FOCUS_COUNT = 3;
/**
 * The deterministic fallback plan: the next unfocused vectors from the
 * kind's roster, rotating by wave so successive fallback waves do not
 * repeat each other. Used whenever the coordinator's reply is missing,
 * unreadable, or invalid — the reason is carried on the plan.
 * @param rec - The campaign record.
 * @param kind - The campaign kind (roster source).
 * @param waveIndex - The wave being planned.
 * @param reason - Why the fallback is being used (recorded verbatim).
 * @param opts - Prior waves' focused vector names, and the clock.
 * @returns The fallback plan.
 */
export declare function deterministicFallbackPlan(rec: CampaignRecord, kind: CampaignKind, waveIndex: number, reason: string, opts?: {
    priorFocusVectors?: string[];
    now?: Date;
}): WavePlan;
/**
 * Plan the next wave: ask the coordinator, validate what comes back,
 * and fall back deterministically when the reply cannot be used.
 * Never throws for planner/output failures — the fallback IS the
 * failure path, and its reason is on the returned plan.
 * @param rec - The campaign record.
 * @param kind - The campaign kind.
 * @param waveIndex - The wave to plan (>= 1).
 * @param opts - The injected completion, the history digest for the
 *   planner prompt, prior focus vectors (gap math), and the clock.
 * @returns The wave plan (coordinator-sourced or fallback).
 */
export declare function planNextWave(rec: CampaignRecord, kind: CampaignKind, waveIndex: number, opts?: {
    completion?: WavePlannerCompletion;
    historyDigest?: string;
    priorFocusVectors?: string[];
    now?: Date;
}): Promise<WavePlan>;
/**
 * The plan artifact path for a wave: `<campaignDir>/wave-<n>/plan.json`.
 * @param campaignDir - The campaign's own directory.
 * @param waveIndex - The wave index.
 * @returns The plan file path.
 */
export declare function wavePlanPath(campaignDir: string, waveIndex: number): string;
/**
 * Persist a wave plan as the wave's artifact (plan.json + a readable
 * plan.md). The record's `planRef` points at the JSON.
 * @param campaignDir - The campaign's own directory.
 * @param plan - The plan to write.
 * @returns The planRef to store on the wave record (`wave-<n>/plan.json`).
 */
export declare function writeWavePlan(campaignDir: string, plan: WavePlan): string;
/**
 * Read a wave plan artifact back. Returns undefined when the file is
 * absent or unreadable — a missing plan is repaired by re-planning,
 * never treated as authority.
 * @param campaignDir - The campaign's own directory.
 * @param waveIndex - The wave index.
 * @returns The parsed plan, or undefined.
 */
export declare function loadWavePlan(campaignDir: string, waveIndex: number): WavePlan | undefined;
