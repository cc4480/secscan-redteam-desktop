import { type Harness2Paths, type PatchLayer, type ProbeVerdict, type Proposal, type TargetClass } from "./contract.js";
import { type ExperienceRecord, type ExperienceStatus } from "./experience-record.js";
export * from "./experience-record.js";
/** Thrown whenever adoption, a status transition or a rollback is refused; nothing is written before it. */
export declare class AdoptRefusedError extends Error {
    constructor(message: string);
}
export interface AppendExperienceResult {
    readonly path: string;
    readonly appended: boolean;
    readonly total: number;
}
export interface MarkExperienceResult {
    readonly path: string;
    readonly marked: boolean;
    readonly record?: ExperienceRecord;
}
export interface AppendRevertedResult {
    readonly path: string;
    readonly entry: ExperienceRecord;
    readonly marked: number;
}
export interface AdoptVerdictResult {
    readonly layerId: string;
    readonly experiencePath: string;
}
export interface RollbackLayerResult {
    readonly layerId: string;
    readonly experiencePath: string;
    readonly lesson: ExperienceRecord;
}
export interface AdoptVerdictInput {
    readonly paths: Harness2Paths;
    readonly proposal: Proposal;
    readonly layer: PatchLayer;
    readonly verdict: ProbeVerdict;
    /** Explicit operator approval; anything but true refuses adoption. */
    readonly approve: boolean;
    /** Tuning cycle id recorded in the heading; defaults to `cycle-<date>`. */
    readonly cycleId?: string;
}
export interface RollbackLayerInput {
    readonly paths: Harness2Paths;
    readonly layerId: string;
    readonly reason?: string;
}
export interface ExperienceSelector {
    readonly date?: string;
    readonly layerId?: string;
    readonly cycleId?: string;
    readonly status?: ExperienceStatus["kind"];
}
export interface AppendRevertedInput {
    readonly targetClass: TargetClass;
    readonly layerId?: string;
    readonly cycleId?: string;
    readonly date?: string;
    readonly reason: string;
    readonly changed: string;
    readonly why: string;
    readonly measuredEffect: string;
}
export interface SupersedeInput {
    readonly targetClass: TargetClass;
    readonly layerId: string;
    readonly by: string;
}
/** The pinned-guardrail token a layer/proposal YAML references, if any (slash and whitespace normalized). */
export declare function findPinnedGuardrailReference(yaml: string): string | null;
/**
 * Append one section-7 record: dedupe on (date, layerId, cycleId, changed) and
 * leave every existing byte untouched (true append, never a canonical rewrite).
 */
export declare function appendExperience(paths: Harness2Paths, record: ExperienceRecord): AppendExperienceResult;
/**
 * The ONLY in-place write: replace the `- Status:` line of exactly one record.
 * Refuses (typed error, nothing written) unless exactly one record matches and
 * the status actually changes; every other line stays byte-identical.
 */
export declare function markExperienceStatus(paths: Harness2Paths, targetClass: TargetClass, selector: ExperienceSelector, status: ExperienceStatus): MarkExperienceResult;
/** Mark an active record superseded by a newer layer (consolidation/replacement). */
export declare function supersedeExperience(paths: Harness2Paths, input: SupersedeInput): MarkExperienceResult;
/**
 * Record a rollback: flip the layer's currently active record to `reverted`
 * (status line only) and APPEND one new record carrying that same reverted
 * status, the reason and the measured deltas before the rollback.
 */
export declare function appendRevertedExperience(paths: Harness2Paths, input: AppendRevertedInput): AppendRevertedResult;
/**
 * The ONLY adoption path: refuses unless verdict.adopted AND approve === true,
 * re-checks pinned guardrails (defense in depth), installs + activates the
 * layer and appends the section-7 lesson with Status active. Nothing is written
 * when refused.
 */
export declare function adoptVerdict(input: AdoptVerdictInput): AdoptVerdictResult;
/**
 * Remove an adopted layer and record the rollback: the layer's active record is
 * flipped to `reverted` (status line only) and a new reverted record is
 * appended, so the history is never silently rewritten or deleted.
 */
export declare function rollbackLayer(input: RollbackLayerInput): RollbackLayerResult;
