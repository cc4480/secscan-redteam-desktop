/**
 * The Gold Loop — in-app port (reference: loop.py + evolution.py +
 * scoring.py + challenge.py, over the app-data Foundry store).
 *
 * One cycle:
 *   1. control-validate every store case (structure + sanitizer), timing
 *      each run — the timing feeds fitness cost_efficiency;
 *   2. fitness-score the store's cases (fitness-v1.1-live port) and keep
 *      the table in loop-state.json;
 *   3. mutate the highest-fitness case seeds (operators-v1, case surface,
 *      mutate.ts) and register the survivors of the case control battery
 *      with their lineage to the seed;
 *   4. mutate the highest-fitness GOLD snapshot bundles and validate
 *      them through the foundry-gate runner (loop-bundle.ts).
 *
 * FAILURE ISOLATION: a cycle never throws. Every step records its outcome
 * in the cycle summary; a loop failure cannot affect scans (the capture
 * hook enqueues cycles fire-and-forget through enqueueLoopCycle).
 */
import { type FoundryLocation } from './locate.js';
import { type LoopCycleSummary } from './loop-state.js';
export { loadLoopState, saveLoopState } from './loop-state.js';
export type { BundleMutantOutcome, CaseMutantOutcome, LoopCycleSummary, LoopState } from './loop-state.js';
/**
 * Run one Gold Loop cycle over the store. Never throws.
 *
 * @param storeDir - the foundry store directory
 * @param opts - location override, python command, and clock (tests)
 * @returns the cycle summary (also persisted in loop-state.json)
 */
export declare function runLoopCycle(storeDir: string, opts?: {
    location?: FoundryLocation;
    python?: string;
    now?: () => Date;
}): Promise<LoopCycleSummary>;
/**
 * Enqueue a loop cycle (single-flight). Used by the capture hook: a cycle
 * already running absorbs the enqueue. Never rejects.
 *
 * @param storeDir - the foundry store directory
 * @returns the running cycle's summary promise
 */
export declare function enqueueLoopCycle(storeDir: string): Promise<LoopCycleSummary>;
/**
 * Resolve when no enqueued cycle is running (tests and operator tooling).
 *
 * @returns nothing
 */
export declare function whenLoopIdle(): Promise<void>;
