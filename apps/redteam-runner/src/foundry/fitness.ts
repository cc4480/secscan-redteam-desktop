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

import type { FoundryCase } from './store.js'

/** fitness-v1.1-live weights, keyed by component. */
export const FITNESS_WEIGHTS = {
  discrimination: 0.3,
  difficultyFit: 0.2,
  novelty: 0.2,
  liveSimilarity: 0.15,
  coverageGain: 0.1,
  costEfficiency: 0.05,
} as const

/** One case's fitness record. A component is null when unscored. */
export interface FitnessRecord {
  model: 'fitness-v1.1-live (in-app port)'
  fitness: number | null
  components: {
    discrimination: number | null
    difficultyFit: number | null
    novelty: number | null
    liveSimilarity: number | null
    coverageGain: number | null
    costEfficiency: number | null
  }
  scoredWeight: number
}

/** The token set a case is compared by. */
export function caseTokens(foundryCase: FoundryCase): Set<string> {
  const tokens = new Set<string>()
  tokens.add(`family:${foundryCase.family}`)
  if (foundryCase.cwe) tokens.add(foundryCase.cwe)
  tokens.add(`severity:${foundryCase.severity}`)
  tokens.add(`payload:${foundryCase.payloadClass}`)
  tokens.add(`proof:${foundryCase.proofType}`)
  for (const shape of foundryCase.endpointShape) {
    for (const segment of shape.split(/[/&?={}]+/)) {
      if (segment) tokens.add(`seg:${segment}`)
    }
  }
  for (const fp of foundryCase.techFingerprints) tokens.add(`stack:${fp}`)
  return tokens
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 1 : intersection / union
}

/** RBF kernel (gamma = 0.08) over binary token vectors, as a distance proxy. */
function rbfKernel(a: Set<string>, b: Set<string>, vocabulary: string[]): number {
  let squared = 0
  for (const token of vocabulary) {
    const d = (a.has(token) ? 1 : 0) - (b.has(token) ? 1 : 0)
    squared += d * d
  }
  return Math.exp(-0.08 * squared)
}

function shapeSegments(foundryCase: FoundryCase): Set<string> {
  const out = new Set<string>()
  for (const shape of foundryCase.endpointShape) {
    for (const segment of shape.split(/[/&?={}]+/)) if (segment) out.add(segment)
  }
  return out
}

/**
 * Score every case in the store against the rest of the store.
 *
 * @param cases - all registered live cases
 * @param validationSeconds - measured control-run seconds per case id,
 *   when a loop validation timed them (drives cost_efficiency)
 * @returns fitness records keyed by case id
 */
export function scoreStoreCases(
  cases: readonly FoundryCase[],
  validationSeconds: ReadonlyMap<string, number> = new Map(),
): Map<string, FitnessRecord> {
  const tokenSets = new Map<string, Set<string>>()
  const vocabulary = new Set<string>()
  for (const c of cases) {
    const tokens = caseTokens(c)
    tokenSets.set(c.id, tokens)
    for (const t of tokens) vocabulary.add(t)
  }
  const vocab = [...vocabulary]
  const out = new Map<string, FitnessRecord>()

  const tokensOf = (id: string): Set<string> => tokenSets.get(id) ?? new Set<string>()
  for (const c of cases) {
    const mine = tokensOf(c.id)
    const others = cases.filter(o => o.id !== c.id)

    let novelty: number | null = null
    if (others.length === 0) {
      novelty = 1
    } else {
      let maxSimilarity = 0
      for (const o of others) maxSimilarity = Math.max(maxSimilarity, jaccard(mine, tokensOf(o.id)))
      novelty = 1 - maxSimilarity
    }

    const cellCount = others.filter(o => o.family === c.family && o.tier === c.tier).length
    const coverageGain = 1 / (1 + cellCount)

    const sameFamily = others.filter(o => o.family === c.family)
    let classSupport = 0
    if (sameFamily.length > 0) {
      const kernels = sameFamily
        .map(o => rbfKernel(mine, tokensOf(o.id), vocab))
        .sort((a, b) => b - a)
        .slice(0, 3)
      classSupport = kernels.reduce((a, b) => a + b, 0) / kernels.length
    }
    let shapeMatch = 0
    const myShape = shapeSegments(c)
    if (myShape.size > 0) {
      for (const o of others) shapeMatch = Math.max(shapeMatch, jaccard(myShape, shapeSegments(o)))
    }
    let proofMatch = 0
    if (others.some(o => o.proofType === c.proofType)) proofMatch = 1
    else if (others.some(o => o.proofType === 'cell-proven' || o.proofType === 'state-confirmed')) proofMatch = 0.3
    const liveSimilarity = 0.55 * classSupport + 0.25 * shapeMatch + 0.2 * proofMatch

    const seconds = validationSeconds.get(c.id)
    const costEfficiency = seconds !== undefined && Number.isFinite(seconds) ? 1 / (1 + seconds / 30) : null

    const components = {
      discrimination: null,
      difficultyFit: null,
      novelty,
      liveSimilarity,
      coverageGain,
      costEfficiency,
    }
    const scored: Array<[number, number]> = []
    if (components.novelty !== null) scored.push([FITNESS_WEIGHTS.novelty, components.novelty])
    if (components.liveSimilarity !== null) scored.push([FITNESS_WEIGHTS.liveSimilarity, components.liveSimilarity])
    if (components.coverageGain !== null) scored.push([FITNESS_WEIGHTS.coverageGain, components.coverageGain])
    if (components.costEfficiency !== null) scored.push([FITNESS_WEIGHTS.costEfficiency, components.costEfficiency])
    const scoredWeight = scored.reduce((a, [w]) => a + w, 0)
    const fitness = scoredWeight > 0 ? scored.reduce((a, [w, v]) => a + w * v, 0) / scoredWeight : null

    out.set(c.id, { model: 'fitness-v1.1-live (in-app port)', fitness, components, scoredWeight })
  }
  return out
}
