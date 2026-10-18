import type { PairMode, PairRun } from "./pair-select.js";
import type { Harness2Store } from "./store-model.js";
export { MAX_PAIRS, MIN_USABLE_RUNS, WINDOW_FALLBACK_DAYS, WINDOW_FALLBACK_MIN, WINDOW_SIZE } from "./pair-select.js";
/** A package always carries at least this many contrasted pairs (spec section 6). */
export declare const MIN_PAIRS = 2;
/** Pairs per package unless the caller asks for fewer. */
export declare const DEFAULT_PAIR_COUNT = 3;
/** Class scan cap for the window; the package is a contrast, not an archive. */
export declare const RUN_SCAN_LIMIT = 5000;
/** Aggregate scan cap: every class's own window is recomputed from this snapshot. */
export declare const METRICS_SCAN_LIMIT = 5000;
/** One section-3 contrast: a high-yield run against a low-yield run of the class. */
export interface SelectedContrast {
    readonly high: PairRun;
    readonly low: PairRun;
    /** Why this pair; empty when it is a plain quartile contrast. */
    readonly note: string;
}
/** Everything section 3 needs, in the section-6 package shape. */
export interface PackageSelection {
    /** INSUFFICIENT_DATA means no package is built (cold start). */
    readonly mode: PairMode;
    readonly modeReason: string;
    /** Usable runs in the window (what the cold-start threshold counted). */
    readonly usableRuns: number;
    readonly windowSize: number;
    readonly windowDays: number;
    readonly windowMethod: string;
    readonly quartileMethod: string;
    readonly failureModeCoverage: readonly string[];
    readonly representativeRunIds: readonly string[];
    readonly pairs: readonly SelectedContrast[];
    /** The tuner's explicit selection-criteria statements, verbatim. */
    readonly criteria: readonly string[];
    /** Newest run's ordered layer set (the current base composition). */
    readonly latestLayerSet: readonly string[];
}
export interface SelectPackageContrastsInput {
    readonly store: Harness2Store;
    readonly targetClass: string;
    readonly nowMs?: number;
    readonly maxPairs?: number;
}
/** Run the canonical section-9 selection and expose it as section-3 package data. */
export declare function selectPackageContrasts(input: SelectPackageContrastsInput): PackageSelection;
/** Aggregate metrics for one target class over its section-9 window, with N stated. */
export interface ClassMetrics {
    readonly targetClass: string;
    readonly n: number;
    readonly successRate: number;
    readonly meanVulns: number;
    readonly fpRate: number;
    readonly meanSteps: number;
    readonly meanTokens: number;
    readonly crashRate: number;
}
/** Section-4 aggregate: the window means per target class. */
export interface PackageMetrics {
    /** N of the package target class's window. */
    readonly windowN: number;
    readonly windowDays: number;
    readonly windowMethod: string;
    readonly window: ClassMetrics;
    readonly byTargetClass: readonly ClassMetrics[];
}
/** Section 4: window means of every target class the store knows, with N. */
export declare function buildPackageMetrics(store: Harness2Store, targetClass: string, nowMs?: number): PackageMetrics;
