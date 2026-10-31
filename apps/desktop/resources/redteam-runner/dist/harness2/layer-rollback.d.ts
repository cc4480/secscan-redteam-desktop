import type { Harness2Paths, TargetClass } from "./contract.js";
import { type IncidentRecord } from "./lifecycle-state.js";
/** The five metric deltas recorded when a rollback has measurements. */
export interface RollbackDeltas {
    readonly vulnsFound: number;
    readonly falsePositives: number;
    readonly steps: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
}
export interface RollbackInput {
    readonly paths: Harness2Paths;
    readonly layerId: string;
    readonly reason: string;
    readonly targetClass?: TargetClass;
    readonly cycleId?: string;
    readonly date?: string;
    readonly now?: Date;
    /** Measured deltas at rollback time (the monitor supplies these). */
    readonly measuredEffect?: string;
    readonly deltas?: RollbackDeltas;
    readonly baseRuns?: number;
    readonly candidateRuns?: number;
    /** Run ids that motivated the rollback (recorded in `- Why (...)`). */
    readonly runIds?: readonly string[];
    readonly why?: string;
    readonly operator?: string;
    /** Guardrail incident: deactivation is flagged as an incident, never routine. */
    readonly incident?: boolean;
    /** The detected incident kind (defaults to guardrail-touch). */
    readonly incidentKind?: "guardrail-touch" | "unreadable-layer";
    readonly incidentDetail?: string;
    readonly pinned?: readonly string[];
}
export interface RollbackResult {
    readonly layerId: string;
    readonly targetClass: TargetClass;
    readonly cycleId: string;
    readonly archiveDir: string;
    readonly archiveManifestPath: string;
    readonly experiencePath: string;
    readonly activeBefore: readonly string[];
    readonly activeIds: readonly string[];
    readonly incident: boolean;
    readonly incidentRecord?: IncidentRecord;
}
/** A refused rollback; nothing is changed when it is thrown. */
export declare class RollbackRefusedError extends Error {
    constructor(message: string);
}
/**
 * Roll a layer back to the permanent archive (section 11.3). The archive is
 * never deleted and a second rollback of the same id is refused.
 */
export declare function rollbackLayerToArchive(input: RollbackInput): RollbackResult;
export interface RaiseIncidentInput {
    readonly paths: Harness2Paths;
    readonly layerId: string;
    readonly targetClass: TargetClass;
    readonly kind: "guardrail-touch" | "unreadable-layer";
    readonly detail: string;
    readonly pinned?: readonly string[];
    readonly now?: Date;
    readonly action?: string;
}
/** Record a guardrail incident and put it on the operator attention queue. */
export declare function raiseIncident(input: RaiseIncidentInput): IncidentRecord;
