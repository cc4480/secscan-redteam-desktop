import type { Harness2Paths } from "./contract.js";
/** How many runs after an adoption the monitor watches (spec section 11.5). */
export declare const MONITOR_WINDOW = 10;
/** A freeze: new proposals for this target class need an operator first. */
export interface FreezeRecord {
    readonly targetClass: string;
    /** Why new proposals are frozen (the gate verdict + failed conditions). */
    readonly reason: string;
    /** ISO date the freeze was applied, YYYY-MM-DD. */
    readonly date: string;
    /** ISO timestamp of the freeze write. */
    readonly flaggedAt: string;
    /** The gate verdict that caused the freeze. */
    readonly verdict: string;
}
/** One operator attention flag (freeze or incident); append-only. */
export interface OperatorFlag {
    readonly ts: string;
    readonly kind: "consolidation-freeze" | "guardrail-incident" | "monitor-rollback";
    readonly targetClass?: string;
    readonly layerId?: string;
    readonly detail: string;
}
/** One adoption the monitor tracks for its following 10 runs. */
export interface AdoptionRecord {
    readonly layerId: string;
    readonly targetClass: string;
    readonly cycleId: string;
    /** Epoch ms of adoption; runs at/after this timestamp are the monitor window. */
    readonly adoptedAtMs: number;
    readonly adoptedAtIso: string;
    /** S measured at adoption (gate candidate score); absent = derive from the store. */
    readonly sAtAdoption?: number;
    /** CR measured at adoption (gate candidate crash rate). */
    readonly crAtAdoption?: number;
    /** Epoch ms the monitoring window closed; absent = still monitored. */
    readonly closedAtMs?: number;
    readonly closeReason?: string;
}
/** One recorded incident (guardrail touch in an active layer). */
export interface IncidentRecord {
    readonly ts: string;
    readonly kind: "guardrail-touch" | "unreadable-layer";
    readonly layerId: string;
    readonly targetClass: string;
    readonly detail: string;
    readonly pinned: readonly string[];
    /** The action taken (always a deactivation for an active-layer incident). */
    readonly action: string;
}
/** `<root>/lifecycle`. */
export declare function lifecycleDir(paths: Harness2Paths): string;
export declare function freezePath(paths: Harness2Paths): string;
export declare function flagsPath(paths: Harness2Paths): string;
export declare function adoptionsPath(paths: Harness2Paths): string;
export declare function incidentsPath(paths: Harness2Paths): string;
/** Every freeze currently in force, sorted by target class. */
export declare function readFreezes(paths: Harness2Paths): FreezeRecord[];
/** The class's freeze record, or null when it is not frozen. */
export declare function readFreeze(paths: Harness2Paths, targetClass: string): FreezeRecord | null;
/** True when new proposals for the class are frozen. */
export declare function isFrozen(paths: Harness2Paths, targetClass: string): boolean;
/** Freeze a class and flag the operator. Returns the record written. */
export declare function freezeClass(paths: Harness2Paths, record: FreezeRecord): FreezeRecord;
/** Remove a class's freeze (an operator decision). Returns true when one existed. */
export declare function clearFreeze(paths: Harness2Paths, targetClass: string): boolean;
/** Record one operator attention flag. */
export declare function appendFlag(paths: Harness2Paths, flag: OperatorFlag): OperatorFlag;
/** Every operator flag ever raised (oldest first); unreadable lines are skipped. */
export declare function readFlags(paths: Harness2Paths): OperatorFlag[];
/** Record one guardrail incident. */
export declare function appendIncident(paths: Harness2Paths, incident: IncidentRecord): IncidentRecord;
/** Every incident ever recorded (oldest first). */
export declare function readIncidents(paths: Harness2Paths): IncidentRecord[];
/** Tolerant JSONL reader: skips unreadable lines, never throws. */
export declare function readJsonLines<T>(path: string): T[];
/** Every adoption record, oldest first. */
export declare function readAdoptions(paths: Harness2Paths): AdoptionRecord[];
/** Register (or replace, by layerId) one adoption for auto-rollback monitoring. */
export declare function recordAdoption(paths: Harness2Paths, record: AdoptionRecord): AdoptionRecord;
/** Mark an adoption's monitoring window closed (rollback, incident or window complete). */
export declare function closeAdoption(paths: Harness2Paths, layerId: string, reason: string, atMs: number): boolean;
/** Find one adoption record by layer id. */
export declare function findAdoption(paths: Harness2Paths, layerId: string): AdoptionRecord | null;
