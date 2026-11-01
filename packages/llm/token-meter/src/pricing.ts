/**
 * Dollar pricing for provider-usage buckets, keyed by route.
 *
 * Rates exist only where the provider declares them: the table below is
 * transcribed from the rate declarations in the llm-router's Meta provider
 * header (`packages/redteam/llm-router/src/providers/meta.ts`). A route with
 * no declared rate — notably `meta/muse-spark-1.1`, registered without a
 * price line — prices to `undefined`, and callers show the token split with
 * no dollar figure. No rate is interpolated, defaulted, or borrowed from a
 * sibling model.
 *
 * @module @deepseek-ai/dsh-token-meter/pricing
 */

import type { TurnTokenUsageRoute } from './turn-usage.ts'

/** Per-bucket USD rates for one route, each per one million tokens. */
export interface TokenUsageRate {
  /** Fresh input rate; also the cache-write rate (the declared table carries no separate write rate). */
  readonly inputUsdPerMillion: number
  /** Cache-read input rate. */
  readonly cachedInputUsdPerMillion: number
  /** Output rate. */
  readonly outputUsdPerMillion: number
}

/**
 * The disjoint provider-usage buckets a price is computed from.
 *
 * Both cache buckets are optional in the type because the turn fold reports
 * each one only when every billed attempt reported it; the estimator treats
 * an absent bucket as unproven and declines to price (see
 * {@link estimateTokenUsageCostUsd}).
 */
export interface TokenUsageCostBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

const SPARK_RATE: TokenUsageRate = {
  inputUsdPerMillion: 1.25,
  cachedInputUsdPerMillion: 0.15,
  outputUsdPerMillion: 4.25,
}

const WONDER_RATE: TokenUsageRate = {
  inputUsdPerMillion: 4,
  cachedInputUsdPerMillion: 0.2,
  outputUsdPerMillion: 20,
}

/** Declared rates by `provider/model`; absence from this table means unpriced, never estimated. */
const TOKEN_USAGE_RATES: Readonly<Record<string, TokenUsageRate>> = {
  'meta/muse-spark-1.3': SPARK_RATE,
  // Declared at the same rates as muse-spark-1.3 in the same header table.
  'meta/muse-spark-1.2': SPARK_RATE,
  'meta/muse-wonder-1.0': WONDER_RATE,
}

/**
 * Look up the declared rate for one provider/model route.
 * @param provider - provider id as recorded on the billed attempt (e.g. `meta`).
 * @param model - model id as recorded on the billed attempt (e.g. `muse-spark-1.3`).
 * @returns the declared rate, or undefined when the route declares none.
 */
export function tokenUsageRate(provider: string, model: string): TokenUsageRate | undefined {
  return TOKEN_USAGE_RATES[`${provider}/${model}`]
}

function sameRate(left: TokenUsageRate, right: TokenUsageRate): boolean {
  return left.inputUsdPerMillion === right.inputUsdPerMillion
    && left.cachedInputUsdPerMillion === right.cachedInputUsdPerMillion
    && left.outputUsdPerMillion === right.outputUsdPerMillion
}

/**
 * Price usage buckets in USD under the routes that produced them.
 *
 * The buckets aggregate every billed attempt, so an exact price exists only
 * when the attempts share one rate: `routes` must be present, every route
 * must declare a rate, and all declared rates must be identical. A turn that
 * mixed differently-priced routes cannot be priced from its aggregate
 * buckets and returns undefined rather than an attributed guess. An absent
 * cache bucket likewise returns undefined: the fold omits a bucket it could
 * not prove, and pricing around the omission would understate the total.
 *
 * Cache writes price at the fresh input rate: the declared table carries
 * three rates (fresh in / cached in / out), and a cache write is fresh
 * prompt processing, not a cache read.
 *
 * @param buckets - the disjoint usage buckets to price.
 * @param routes - every route that contributed a billed attempt, when known.
 * @returns the USD cost, or undefined when no exact price exists.
 */
export function estimateTokenUsageCostUsd(
  buckets: TokenUsageCostBuckets,
  routes: readonly TurnTokenUsageRoute[] | undefined,
): number | undefined {
  if (routes === undefined || routes.length === 0) return undefined
  if (buckets.cacheReadTokens === undefined || buckets.cacheWriteTokens === undefined) {
    return undefined
  }
  let rate: TokenUsageRate | undefined
  for (const route of routes) {
    const candidate = tokenUsageRate(route.provider, route.model)
    if (candidate === undefined) return undefined
    if (rate === undefined) rate = candidate
    else if (!sameRate(rate, candidate)) return undefined
  }
  if (rate === undefined) return undefined
  const freshInputTokens = buckets.uncachedInputTokens + buckets.cacheWriteTokens
  return (
    freshInputTokens * rate.inputUsdPerMillion
    + buckets.cacheReadTokens * rate.cachedInputUsdPerMillion
    + buckets.outputTokens * rate.outputUsdPerMillion
  ) / 1_000_000
}
