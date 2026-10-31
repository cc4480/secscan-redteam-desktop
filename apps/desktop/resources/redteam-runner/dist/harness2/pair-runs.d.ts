/**
 * Harness2 section-9 window scan and cold-start mode decision.
 *
 * WINDOW: the most recent WINDOW_SIZE (50) USABLE runs of the class whose
 * harness_version is the current base harness version. A usable run has a
 * complete metrics row (steps_count > 0) and is not crashed (operator
 * kill-switch runs are not a harness signal). If that yields fewer than
 * WINDOW_FALLBACK_MIN (10) usable runs the window falls back to the last
 * WINDOW_FALLBACK_DAYS (90) days of usable runs (any harness_version); the
 * fallback is named in windowMethod so the package can state it.
 *
 * COLD START (spec section 9):
 *   - fewer than MIN_USABLE_RUNS (4) usable runs -> mode INSUFFICIENT_DATA: no
 *     package and no representative runs;
 *   - all usable runs succeeded -> HARDEN, representative runs = fastest,
 *     median and slowest by tokens;
 *   - no usable run succeeded -> REPAIR-FOUNDATION, representative runs = three
 *     failures with distinct failure modes (filled up when fewer modes exist);
 *   - otherwise -> REPAIR (pair-select.ts selects the contrasted pairs).
 *
 * The caller passes rows, so this module never opens the database and is
 * trivially testable; store-model.RunRow is structurally compatible.
 */
/** Runs considered for the window. */
export declare const WINDOW_SIZE = 50;
/** Fallback look-back when the harness-version window is too thin. */
export declare const WINDOW_FALLBACK_DAYS = 90;
/** Below this usable count the window falls back to the 90-day rule. */
export declare const WINDOW_FALLBACK_MIN = 10;
/** Below this usable count there is no package at all. */
export declare const MIN_USABLE_RUNS = 4;
/** Hard cap on contrasted pairs (spec section 9). */
export declare const MAX_PAIRS = 3;
/** Mode decided by the cold-start rules; INSUFFICIENT_DATA means no package. */
export declare const PAIR_MODES: readonly ["REPAIR", "HARDEN", "REPAIR-FOUNDATION", "INSUFFICIENT_DATA"];
export type PairMode = (typeof PAIR_MODES)[number];
/** The fields window/pair selection reads; store-model.RunRow is structurally compatible. */
export interface PairRun {
    readonly runId: string;
    readonly ts: number;
    readonly targetClass: string;
    readonly targetSubclass?: string;
    readonly harnessVersion: string;
    readonly outcome: string;
    readonly success: boolean;
    readonly vulnsFound: number;
    readonly claimsTotal: number;
    readonly falsePositives: number;
    readonly stepsCount: number;
    readonly tokensTotal: number;
    readonly crashed: boolean;
    readonly failureMode: string;
}
export interface PairWindow {
    readonly runs: readonly PairRun[];
    readonly size: number;
    /** "harness-version" or "fallback-90d". */
    readonly method: string;
    readonly days: number;
    readonly harnessVersion: string;
}
/** A run usable for the window: metrics present (steps > 0) and not crashed. */
export declare function isUsablePairRun(run: PairRun): boolean;
/** Newest first, runId ascending as the deterministic tie-break. */
export declare function newestFirst(a: PairRun, b: PairRun): number;
export interface WindowInput {
    readonly rows: readonly PairRun[];
    /** The current base harness version the window must match. */
    readonly harnessVersion: string;
    /** Clock seam; defaults to the newest run's ts. */
    readonly nowMs?: number;
    readonly windowSize?: number;
    readonly fallbackDays?: number;
    readonly fallbackMin?: number;
}
/** Pick the section-9 window (harness-version first, 90-day fallback). Pure. */
export declare function pickWindow(input: WindowInput): PairWindow;
export interface ModeDecision {
    readonly mode: PairMode;
    readonly reason: string;
}
/** Apply the cold-start ladder; the first rule that fires wins. */
export declare function decidePairMode(window: readonly PairRun[], minUsable?: number): ModeDecision;
/** Representative run ids cited by a cold-start mode (empty for INSUFFICIENT_DATA/REPAIR). */
export declare function coldStartRunIds(mode: PairMode, window: readonly PairRun[]): string[];
