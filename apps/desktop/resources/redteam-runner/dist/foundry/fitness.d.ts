/**
 * Fitness — fitness-v1.1-live, in-app port (reference: scoring.py).
 *
 *   F = 0.30·discrimination + 0.20·difficulty_fit + 0.20·novelty
 *     + 0.15·live_similarity + 0.10·coverage_gain + 0.05·cost_efficiency
 *
 * The port scores the store's live cases against each other. Components
 * that need data a live case does not carry are UNSCORED (null), never
 * invented, and the remaining weights renormalize — the reference rule:
 * an absent input can never masquerade as a score.
 *   - discrimination = 4·p·(1−p) over a reference-panel pass rate p.
 *     Live cases have no panel run → unscored.
 *   - difficulty_fit compares p against the assigned tier band → unscored
 *     for the same reason.
 *   - novelty = 1 − max Jaccard similarity of token sets against every
 *     other case in the store (reference formula over bundle tokens; here
 *     the token set is family + CWE + shape segments + payload class +
 *     stack fingerprints + severity).
 *   - coverage_gain = 1/(1+n), n = other cases in the same family × tier
 *     cell (reference formula, cell = class × tier there, family × tier
 *     here).
 *   - live_similarity = 0.55·class_support + 0.25·shape_match
 *     + 0.20·proof_match (reference weights). class_support is the mean
 *     RBF kernel (gamma = 0.08) over binary token vectors to the 3 nearest
 *     same-family cases (0.0 when the family has no other case — the
 *     reference's measured SSRF/traversal hole); shape_match is the best
 *     endpoint-shape Jaccard against any other case; proof_match is 1.0
 *     when another case shares the proof type, else 0.3 when any other
 *     case carries a demonstrated proof type, else 0.
 *   - cost_efficiency = 1/(1 + validation_seconds/30), scored only when a
 *     validation timing was measured for the case (loop control runs).
 */
import type { FoundryCase } from './store.js';
/** fitness-v1.1-live weights, keyed by component. */
export declare const FITNESS_WEIGHTS: {
    readonly discrimination: 0.3;
    readonly difficultyFit: 0.2;
    readonly novelty: 0.2;
    readonly liveSimilarity: 0.15;
    readonly coverageGain: 0.1;
    readonly costEfficiency: 0.05;
};
/** One case's fitness record. A component is null when unscored. */
export interface FitnessRecord {
    model: 'fitness-v1.1-live (in-app port)';
    fitness: number | null;
    components: {
        discrimination: number | null;
        difficultyFit: number | null;
        novelty: number | null;
        liveSimilarity: number | null;
        coverageGain: number | null;
        costEfficiency: number | null;
    };
    scoredWeight: number;
}
/** The token set a case is compared by. */
export declare function caseTokens(foundryCase: FoundryCase): Set<string>;
/**
 * Score every case in the store against the rest of the store.
 *
 * @param cases - all registered live cases
 * @param validationSeconds - measured control-run seconds per case id,
 *   when a loop validation timed them (drives cost_efficiency)
 * @returns fitness records keyed by case id
 */
export declare function scoreStoreCases(cases: readonly FoundryCase[], validationSeconds?: ReadonlyMap<string, number>): Map<string, FitnessRecord>;
