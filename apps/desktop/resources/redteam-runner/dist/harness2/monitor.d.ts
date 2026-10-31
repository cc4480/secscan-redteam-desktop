import type { Harness2Paths } from "./contract.js";
import { type IncidentRecord } from "./lifecycle-state.js";
import { type Harness2Store } from "./store.js";
export { guardrailTouches } from "./monitor-window.js";
export type { GuardrailTouch } from "./monitor-window.js";
/** Rule 1: a 10-run S below the at-adoption S by more than this rolls back. */
export declare const S_DROP_THRESHOLD = 0.08;
/** Rule 2: a CR above the at-adoption CR by more than this rolls back immediately. */
export declare const CR_RISE_THRESHOLD = 0.03;
/** Audit trail, relative to `<root>`. */
export declare const EVALUATION_LOG = "monitor/evaluations.jsonl";
/** One logged monitor evaluation (the audit trail). */
export interface MonitorEvaluation {
    readonly ts: string;
    readonly layerId: string;
    readonly targetClass: string;
    readonly cycleId: string;
    /** Runs in the window (capped at MONITOR_WINDOW). */
    readonly window: number;
    readonly runIds: readonly string[];
    readonly sWindow: number | null;
    readonly sAtAdoption: number | null;
    readonly sDropThreshold: number;
    readonly crWindow: number;
    readonly crAtAdoption: number;
    readonly crRiseThreshold: number;
    readonly rules: {
        readonly sDrop: boolean;
        readonly crRise: boolean;
        readonly guardrailTouch: boolean;
    };
    readonly action: "none" | "rolled-back" | "deactivated-incident";
    readonly note: string;
}
/** One action the monitor took (empty when nothing triggered). */
export interface MonitorAction {
    readonly layerId: string;
    readonly action: "rolled-back" | "deactivated-incident";
    readonly reason: string;
    readonly archiveDir?: string;
    readonly experiencePath?: string;
}
export interface MonitorOptions {
    readonly paths: Harness2Paths;
    /** Injectable section-5 store; when absent the monitor opens (and closes) the real one. */
    readonly store?: Harness2Store;
    readonly now?: Date;
    /** false = evaluate + log only, take no action (operator dry run). */
    readonly apply?: boolean;
}
export interface MonitorRunResult {
    readonly evaluations: readonly MonitorEvaluation[];
    readonly actions: readonly MonitorAction[];
    readonly incidents: readonly IncidentRecord[];
    readonly activeIds: readonly string[];
}
/** `<root>/monitor` (the monitor's audit trail lives outside the layer store). */
export declare function monitorDir(paths: Harness2Paths): string;
/** `<root>/monitor/evaluations.jsonl`. */
export declare function evaluationLogPath(paths: Harness2Paths): string;
/** Every logged evaluation, oldest first (tolerant reader; never throws). */
export declare function readMonitorEvaluations(paths: Harness2Paths): MonitorEvaluation[];
/**
 * Run one monitor pass: guardrail touches first, then every open adoption's
 * 10-run window. Evaluations are always logged; rollbacks happen only when
 * apply is true.
 */
export declare function runAutoRollbackMonitor(options: MonitorOptions): MonitorRunResult;
