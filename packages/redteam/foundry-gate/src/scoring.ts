import type { FitnessComponents, FoundryFitnessComponents, ScoreResult } from './types.js'

/** Scoring model version, matching the Foundry's fitness model. */
export const MODEL_VERSION = 'fitness-v1.1-live'

/** Fitness weights by component name. */
export const WEIGHTS: Record<keyof FitnessComponents, number> = {
  discrimination: 0.30,
  difficulty_fit: 0.20,
  novelty: 0.20,
  live_similarity: 0.15,
  coverage_gain: 0.10,
  cost_efficiency: 0.05,
}

/** Pass-rate band [low, high] for each difficulty tier. */
export const BANDS: Record<number, [number, number]> = {
  1: [0.70, 0.95],
  2: [0.40, 0.70],
  3: [0.10, 0.40],
}

/**
 * Round to four decimal places, as the Foundry scoring model does.
 *
 * @param value - the value to round
 * @returns the value rounded to 4 decimal places
 */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/**
 * Discrimination of a panel outcome: 4p(1-p) for pass rate p. A bundle that
 * exactly half the panel solves scores 1; one all or none solve scores 0.
 *
 * @param rate - the panel pass rate, 0 to 1
 * @returns the discrimination component, rounded to 4 decimal places
 */
export function discrimination(rate: number): number {
  return round4(4 * rate * (1 - rate))
}

/**
 * Fit of a panel pass rate to a tier's target band: 1 inside the band,
 * otherwise 1 minus the distance to the nearest band edge, floored at 0.
 *
 * @param rate - the panel pass rate, 0 to 1
 * @param tier - the assigned difficulty tier
 * @returns the difficulty fit component, 0 to 1
 */
export function difficultyFit(rate: number, tier: number): number {
  const band = BANDS[tier]
  if (!band) throw new Error(`unknown tier ${tier}`)
  const [lo, hi] = band
  if (rate >= lo && rate <= hi) return 1.0
  const dist = rate < lo ? lo - rate : rate - hi
  return Math.max(0.0, 1.0 - dist)
}

/** Inputs for {@link computeFitness}. */
export interface FitnessInputs {
  /** Live panel pass rate for the bundle. */
  passRate: number
  /** The bundle's assigned difficulty tier. */
  tier: number
  /** Corpus-relative components issued by the Foundry in the manifest. */
  issued: FoundryFitnessComponents
  /** Whether the bundle-probe layer discriminated the bundle. */
  gatePass: boolean
}

/**
 * Combine live panel components with the Foundry-issued corpus-relative
 * components into a fitness score. Discrimination and difficulty fit are
 * computed live from the panel result; novelty, live similarity, coverage
 * gain, and cost efficiency are taken from the manifest and named in
 * `issued_components`. Weights renormalize over the non-null components.
 * A failed gate forces fitness 0.
 *
 * @param inputs - the live pass rate, assigned tier, issued components, gate
 * @returns the components used, their origin, the fitness, and the gate state
 */
export function computeFitness(inputs: FitnessInputs): ScoreResult {
  const components: FitnessComponents = {
    discrimination: discrimination(inputs.passRate),
    difficulty_fit: round4(difficultyFit(inputs.passRate, inputs.tier)),
    novelty: inputs.issued.novelty,
    live_similarity: inputs.issued.live_similarity,
    coverage_gain: inputs.issued.coverage_gain,
    cost_efficiency: inputs.issued.cost_efficiency,
  }
  const issuedComponents = (Object.keys(WEIGHTS) as (keyof FitnessComponents)[])
    .filter(name => name !== 'discrimination' && name !== 'difficulty_fit' && components[name] !== null)
  let available = 0
  let weighted = 0
  for (const name of Object.keys(WEIGHTS) as (keyof FitnessComponents)[]) {
    const value = components[name]
    if (value !== null) {
      available += WEIGHTS[name]
      weighted += WEIGHTS[name] * value
    }
  }
  const fitness = inputs.gatePass && available > 0 ? round4(weighted / available) : 0
  return { components, issued_components: issuedComponents, fitness, gate_pass: inputs.gatePass }
}
