import { describe, expect, it } from 'vitest'
import { estimateTokenUsageCostUsd, tokenUsageRate } from '../src/pricing.ts'
import type { TokenUsageCostBuckets } from '../src/pricing.ts'

const SPARK = { provider: 'meta', model: 'muse-spark-1.3' }
const SPARK_12 = { provider: 'meta', model: 'muse-spark-1.2' }
const SPARK_11 = { provider: 'meta', model: 'muse-spark-1.1' }
const WONDER = { provider: 'meta', model: 'muse-wonder-1.0' }

describe('tokenUsageRate', () => {
  it('returns the declared Meta rates from the llm-router provider header table', () => {
    expect(tokenUsageRate('meta', 'muse-spark-1.3')).toEqual({
      inputUsdPerMillion: 1.25,
      cachedInputUsdPerMillion: 0.15,
      outputUsdPerMillion: 4.25,
    })
    expect(tokenUsageRate('meta', 'muse-spark-1.2')).toEqual({
      inputUsdPerMillion: 1.25,
      cachedInputUsdPerMillion: 0.15,
      outputUsdPerMillion: 4.25,
    })
    expect(tokenUsageRate('meta', 'muse-wonder-1.0')).toEqual({
      inputUsdPerMillion: 4,
      cachedInputUsdPerMillion: 0.2,
      outputUsdPerMillion: 20,
    })
  })

  it('declines routes with no declared rate instead of inventing one', () => {
    // muse-spark-1.1 is registered in the router with no price line.
    expect(tokenUsageRate('meta', 'muse-spark-1.1')).toBeUndefined()
    expect(tokenUsageRate('deepseek', 'deepseek-chat')).toBeUndefined()
    expect(tokenUsageRate('meta', 'muse-spark-9.9')).toBeUndefined()
  })
})

describe('estimateTokenUsageCostUsd', () => {
  // The diagnosed live session (2026-10-31): 54 steps, ~125K average prompt,
  // 91% cache hit, 6.8M headline tokens. Composition from the diagnosis:
  // 6.14M cache-read, 0.61M fresh uncached input, ~0.055M output.
  const diagnosed: TokenUsageCostBuckets = {
    uncachedInputTokens: 610_000,
    cacheReadTokens: 6_140_000,
    cacheWriteTokens: 0,
    outputTokens: 55_000,
  }

  it('prices the diagnosed session cache-aware: fresh volume is under 10% of the headline', () => {
    const freshTokens = diagnosed.uncachedInputTokens
      + (diagnosed.cacheWriteTokens ?? 0)
      + diagnosed.outputTokens
    expect(freshTokens).toBe(665_000)

    const cost = estimateTokenUsageCostUsd(diagnosed, [SPARK])
    // 0.61M x $1.25 + 6.14M x $0.15 + 0.055M x $4.25 = $1.91725, the
    // diagnosis's ~$1.91 cache-aware price for the turn.
    expect(cost).toBeCloseTo(1.91725, 8)
  })

  it('contrasts with the headline-rate reading of the same volume (~$8.66)', () => {
    // Every prompt token at fresh freight: the reading a cache-blind
    // counter invites, and the divergence the diagnosis measured at ~4.5x.
    const headlineBuckets: TokenUsageCostBuckets = {
      uncachedInputTokens: 6_750_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 55_000,
    }
    const headline = estimateTokenUsageCostUsd(headlineBuckets, [SPARK])
    expect(headline).toBeCloseTo(8.67125, 8)
    const cacheAware = estimateTokenUsageCostUsd(diagnosed, [SPARK])
    expect(cacheAware).toBeDefined()
    expect(headline! / cacheAware!).toBeGreaterThan(4.5)
  })

  it('prices cache writes at the fresh input rate', () => {
    const buckets: TokenUsageCostBuckets = {
      uncachedInputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
      outputTokens: 0,
    }
    expect(estimateTokenUsageCostUsd(buckets, [SPARK])).toBeCloseTo(2.5, 8)
  })

  it('prices the wonder route at its declared rates', () => {
    const buckets: TokenUsageCostBuckets = {
      uncachedInputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      outputTokens: 100_000,
    }
    // 1M x $4 + 1M x $0.20 + 0.1M x $20 = $6.20.
    expect(estimateTokenUsageCostUsd(buckets, [WONDER])).toBeCloseTo(6.2, 8)
  })

  it('prices a multi-route turn only when every route shares one declared rate', () => {
    expect(estimateTokenUsageCostUsd(diagnosed, [SPARK, SPARK_12])).toBeCloseTo(1.91725, 8)
    expect(estimateTokenUsageCostUsd(diagnosed, [SPARK, WONDER])).toBeUndefined()
  })

  it('declines when any route is unpriced, routes are unknown, or a cache bucket is unproven', () => {
    expect(estimateTokenUsageCostUsd(diagnosed, [SPARK_11])).toBeUndefined()
    expect(estimateTokenUsageCostUsd(diagnosed, [SPARK, SPARK_11])).toBeUndefined()
    expect(estimateTokenUsageCostUsd(diagnosed, undefined)).toBeUndefined()
    expect(estimateTokenUsageCostUsd(diagnosed, [])).toBeUndefined()
    const noCacheRead: TokenUsageCostBuckets = {
      uncachedInputTokens: 610_000,
      cacheWriteTokens: 0,
      outputTokens: 55_000,
    }
    expect(estimateTokenUsageCostUsd(noCacheRead, [SPARK])).toBeUndefined()
    const noCacheWrite: TokenUsageCostBuckets = {
      uncachedInputTokens: 610_000,
      cacheReadTokens: 6_140_000,
      outputTokens: 55_000,
    }
    expect(estimateTokenUsageCostUsd(noCacheWrite, [SPARK])).toBeUndefined()
  })
})
