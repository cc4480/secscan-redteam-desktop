/**
 * Gold Loop bundle evolution: mutate the highest-fitness GOLD snapshot
 * bundles into the store's own snapshot and validate them through the
 * foundry-gate runner.
 *
 * Per seed: operators rotate per cycle (reskin is case-level only) until
 * one builds; the mutant is written under <store>/snapshot/bundles/<slug>,
 * every generated Python file must pass the syntax gate, the store
 * manifest gains an entry whose bundle hash is recomputed from the
 * mutant's bytes, and the gate run decides survival — its panel carries
 * the positive (marker fires on the vulnerable twin) and negative
 * (silent on the patched twin) controls. Survivors register as SILVER
 * with lineage; failures are removed from disk and manifest alike.
 */
import { type FoundryLocation } from './locate.js';
import type { BundleMutantOutcome } from './loop-state.js';
/** The outcome of the bundle-evolution step of one cycle. */
export interface BundleEvolutionResult {
    outcomes: BundleMutantOutcome[];
    generated: number;
    survivors: number;
}
/**
 * Run bundle evolution for one cycle.
 *
 * @param storeDir - the foundry store directory
 * @param location - the located snapshot + gate CLI
 * @param cycle - the cycle number (operator rotation + slug suffix)
 * @param at - the cycle timestamp
 * @param python - the Python command for the syntax gate
 * @returns per-seed outcomes and counts; never throws
 */
export declare function runBundleEvolution(storeDir: string, location: FoundryLocation, cycle: number, at: string, python: string): Promise<BundleEvolutionResult>;
