/**
 * Gold Loop persisted state (loop-state.json in the Foundry store):
 * the cycle counter, the latest cycle summary, and the fitness table.
 */
import type { FitnessRecord } from './fitness.js';
/** One case-mutant attempt inside a cycle. */
export interface CaseMutantOutcome {
    seedId: string;
    operator: string;
    ok: boolean;
    detail: string;
    caseId: string | null;
}
/** One bundle-mutant attempt inside a cycle. */
export interface BundleMutantOutcome {
    seedSlug: string;
    operator: string;
    slug: string | null;
    ok: boolean;
    detail: string;
    gatePass: boolean | null;
    fitness: number | null;
}
/** The summary of one loop cycle. */
export interface LoopCycleSummary {
    cycle: number;
    at: string;
    casesScored: number;
    mutantsGenerated: number;
    survivorsRegistered: number;
    caseMutants: CaseMutantOutcome[];
    bundleMutants: BundleMutantOutcome[];
    notes: string[];
    error: string | null;
}
/** Persisted loop state. */
export interface LoopState {
    cyclesRun: number;
    lastCycle: LoopCycleSummary | null;
    fitness: Record<string, FitnessRecord & {
        at: string;
    }>;
}
/**
 * Load the loop state; absent state reads as zero cycles (a store path
 * under a non-directory is absent too — no state file can exist there,
 * and runLoopCycle's never-throws contract relies on the distinction).
 * A state file that exists but cannot be read, parsed, or recognized
 * fails loud instead: reading it as zero lets the next saveLoopState
 * overwrite the real cycle history (counter + fitness table) with a
 * fresh state, and reused cycle numbers corrupt the loop's bookkeeping.
 * Mirrors the registry treatment in store.ts.
 *
 * @param storeDir - the foundry store directory
 * @returns the persisted loop state (zero state when the file is absent)
 */
export declare function loadLoopState(storeDir: string): LoopState;
/**
 * Persist the loop state atomically.
 *
 * @param storeDir - the foundry store directory
 * @param state - the state to write
 * @returns nothing
 */
export declare function saveLoopState(storeDir: string, state: LoopState): void;
