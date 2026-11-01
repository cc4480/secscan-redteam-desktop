/**
 * Evolution — operators-v1, in-app port (reference: evolution.py).
 *
 * Deterministic, label-preserving transforms. Every operator verifies its
 * anchors and FAILS LOUD on a miss — a mutant that cannot be built exactly
 * as specified is not built (the loop records the failure and moves on).
 *
 * Two surfaces, mirroring the reference's two corpora:
 *   - case operators transform a store live case's pattern fields
 *     (marker-rotate → payload-class rotation, rename-param, rename-route,
 *     reskin, naive-filter → the family's filter-bypass payload class);
 *   - bundle operators transform a snapshot bundle's files (marker-rotate
 *     with a fresh FNDRY token derived from sha256(seed:cycle:operator),
 *     rename-param, rename-route, and naive-filter — a per-class naive
 *     blacklist inserted IDENTICALLY into both twins, with the probe
 *     upgraded to the bypassing payload, twin integrity preserved).
 */
import type { CasePattern, FoundryCase } from './store.js';
/** The operator set, in the reference's order. */
export declare const OPERATORS: readonly ["marker-rotate", "rename-param", "rename-route", "reskin", "naive-filter"];
export type Operator = (typeof OPERATORS)[number];
/** An operator outcome: the transformed value, or the loud failure. */
export type OpOutcome<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
};
export declare function pick<T>(options: readonly T[], seedKey: string, exclude?: T): T;
export declare const PARAM_NAMES: readonly ["q", "query", "id", "term", "input", "name", "search"];
export declare const ROUTE_SYNONYMS: Record<string, string>;
/**
 * Apply one operator to a store case's pattern.
 *
 * @param seed - the seed case
 * @param operator - the operator to apply
 * @param cycle - the loop cycle number (deterministic variation input)
 * @returns the mutant pattern, or the loud failure
 */
export declare function applyCaseOperator(seed: FoundryCase, operator: Operator, cycle: number): OpOutcome<CasePattern>;
/**
 * The case-mutant control battery (prove-v2 philosophy, case surface):
 * structure, sanitizer, family-aware dedup, determinism. A control failure
 * rejects the mutant; nothing is repaired.
 *
 * @param mutant - the mutant case to validate
 * @param existing - every case already in the store
 * @param rederive - rebuilds the mutant from its seed; must hash identically
 * @returns pass/fail plus per-control notes
 */
export declare function validateCaseMutant(mutant: FoundryCase, existing: readonly FoundryCase[], rederive: () => FoundryCase | null): {
    pass: boolean;
    notes: string[];
};
