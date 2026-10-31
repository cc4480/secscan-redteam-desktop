import { type PairMode, type PairRun, type PairWindow } from "./pair-runs.js";
export { coldStartRunIds, decidePairMode, isUsablePairRun, MAX_PAIRS, MIN_USABLE_RUNS, PAIR_MODES, pickWindow, WINDOW_FALLBACK_DAYS, WINDOW_FALLBACK_MIN, WINDOW_SIZE, } from "./pair-runs.js";
export type { ModeDecision, PairMode, PairRun, PairWindow, WindowInput } from "./pair-runs.js";
export interface ScoredRun {
    readonly run: PairRun;
    readonly score: number;
    /** 1 = top quartile, 4 = bottom quartile; 2/3 are the middle half. */
    readonly quartile: 1 | 2 | 3 | 4;
}
export interface SelectedPair {
    readonly high: PairRun;
    readonly low: PairRun;
    readonly scoreGap: number;
    readonly sameSubclass: boolean;
    /** The contrasted failure mode: the low run's failure_mode, else the high's. */
    readonly failureMode: string;
    readonly failureModeDistinct: boolean;
    /** "quartile" or "fallback-ranked". */
    readonly source: string;
    readonly note?: string;
}
export interface PairSelection {
    readonly mode: PairMode;
    readonly modeReason: string;
    readonly window: PairWindow;
    readonly windowSize: number;
    readonly windowDays: number;
    readonly windowMethod: string;
    readonly quartileMethod: string;
    readonly baselines: {
        readonly tok: number;
        readonly steps: number;
    };
    readonly scored: readonly ScoredRun[];
    /** S values of the Q1/Q4 boundaries, for the package's criteria statement. */
    readonly quartiles: {
        readonly q1Count: number;
        readonly q4Count: number;
        readonly q1Min: number;
        readonly q4Max: number;
    };
    readonly pairs: readonly SelectedPair[];
    readonly representativeRunIds: readonly string[];
    readonly failureModeCoverage: readonly string[];
    /** Explicit human-readable rule statements for the package. */
    readonly criteria: readonly string[];
}
export interface PairSelectInput {
    readonly rows: readonly PairRun[];
    /** The current base harness version the window must match. */
    readonly harnessVersion: string;
    /** Clock seam; defaults to the newest run's ts (or Date.now() when empty). */
    readonly nowMs?: number;
    readonly maxPairs?: number;
    readonly windowSize?: number;
    readonly fallbackDays?: number;
    readonly fallbackMin?: number;
    readonly minUsableRuns?: number;
}
/** Select the window, cold-start mode and up to MAX_PAIRS contrasted pairs. Pure. */
export declare function selectPairs(input: PairSelectInput): PairSelection;
