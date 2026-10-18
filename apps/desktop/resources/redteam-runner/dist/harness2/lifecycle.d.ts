/**
 * Harness2 layer lifecycle: consolidation + the lifecycle pre-checks
 * (H2-P3, spec section 11).
 *
 * Section 11 rules implemented in this module (rollback lives in
 * ./layer-rollback.ts, the 10-run monitor in ./monitor.ts):
 *
 *  1. MAX-5: at most MAX_ACTIVE_LAYERS (5) layers may be active per profile.
 *     `layers.setActiveLayers` enforces the cap on the single activation path,
 *     and `assertAdoptionCapacity` is the pre-check an adoption path calls
 *     before it even proposes a 6th layer: consolidation is required first.
 *  2. CONSOLIDATION: `consolidateLayers` takes ONE merged layer produced by the
 *     editor from the active stack + EXPERIENCE.md and runs the section-8 gate
 *     with the stack's metrics as base and the merged layer's as candidate.
 *     On ADOPT + operator approval it installs the merged layer with a
 *     section-11.4 file header (parented on the stack), MOVES the whole old
 *     stack into archive/<date>-consolidated/ with a manifest recording ids,
 *     dates and metrics, activates the merged layer as layer 1, marks the old
 *     lessons superseded and registers the new adoption for the monitor.
 *     On REJECT/INSUFFICIENT_DATA (or missing approval) it freezes new
 *     proposals for the class, flags the operator and changes NOTHING: the
 *     layer store, the archive and the active set are untouched, so the stack
 *     never becomes a 6-layer one.
 *  3. Permanent archive: a layer/archive is never deleted. Rollback and
 *     consolidation only MOVE directories into ./layer-archive.ts's dated,
 *     manifest-bearing tree.
 *  4. Layer file headers are rendered by ./layer-headers.ts (layer-id, date,
 *     parent layers, cycle-id, at-adoption metric deltas, status).
 *  5. Freezes and the adoption registry are persisted by ./lifecycle-state.ts.
 */
import type { Harness2Paths, PatchLayer, TargetClass } from "./contract.js";
import { type FreezeRecord } from "./lifecycle-state.js";
import { type GateResult, type MetricSet, type VerdictName } from "./scoring.js";
/** A refused lifecycle operation; nothing is changed when it is thrown. */
export declare class LifecycleError extends Error {
    constructor(message: string);
}
/** The monitor's S for one metric window: self-relative (TOK/STEPS ratios = 1). */
export declare function monitorScore(metrics: MetricSet): number;
/** YYYY-MM-DD for a Date (UTC). */
export declare function isoDate(now?: Date): string;
/** Section-11 pre-check: a 6th adoption needs consolidation first. */
export declare function assertAdoptionCapacity(paths: Harness2Paths): void;
/** Deltas of a merged stack vs the base stack, for the header/lesson line. */
export declare function formatConsolidationDeltas(base: MetricSet, candidate: MetricSet): string;
/** Section-8 gate inputs for consolidation: merged layer vs the active stack. */
export interface ConsolidationGateInput {
    readonly base: MetricSet;
    readonly candidate: MetricSet;
    readonly heldOutTargets: readonly string[];
    readonly trainingTargets: readonly string[];
    readonly logGap?: string;
}
export interface ConsolidateInput {
    readonly paths: Harness2Paths;
    readonly targetClass: TargetClass;
    readonly mergedLayer: PatchLayer;
    readonly gate: ConsolidationGateInput;
    /** Explicit operator approval; anything but true freezes instead of adopting. */
    readonly approve: boolean;
    readonly cycleId?: string;
    readonly date?: string;
    readonly now?: Date;
    readonly operator?: string;
}
export interface ConsolidationResult {
    readonly status: "ADOPTED" | "FROZEN";
    readonly verdict: VerdictName;
    readonly targetClass: TargetClass;
    readonly gate: GateResult;
    /** Ids of the old stack (still active when FROZEN, archived when ADOPTED). */
    readonly archivedLayerIds: readonly string[];
    readonly mergedLayerId?: string;
    /** Position of the merged layer in the new active set: always 1. */
    readonly activationIndex?: number;
    readonly archiveDir?: string;
    readonly archiveManifestPath?: string;
    readonly activeIds: readonly string[];
    readonly freeze?: FreezeRecord;
    readonly superseded?: number;
    /** Non-fatal EXPERIENCE.md notes; the layer store/archive state is authoritative. */
    readonly experienceNotes?: readonly string[];
}
/**
 * Consolidate the active stack into ONE merged layer (section 11.2). The gate
 * decides; on FROZEN nothing in the layer store, archive or active set changes.
 */
export declare function consolidateLayers(input: ConsolidateInput): ConsolidationResult;
/** Every consolidation freeze currently in force (the operator queue). */
export declare function consolidationFreezes(paths: Harness2Paths): FreezeRecord[];
/** The class's consolidation freeze, or null. */
export declare function consolidationFreeze(paths: Harness2Paths, targetClass: TargetClass): FreezeRecord | null;
export { raiseIncident, rollbackLayerToArchive } from "./layer-rollback.js";
export type { RaiseIncidentInput, RollbackDeltas, RollbackInput, RollbackResult, } from "./layer-rollback.js";
