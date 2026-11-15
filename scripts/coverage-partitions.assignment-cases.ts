/** Weight-aware file-to-partition assignment. */

import { describe, expect, it } from 'vitest'
import { assignWeightedPartitions } from './coverage-partitions.ts'

describe('weighted partition assignment', () => {
  it('seeds the heaviest files into different partitions', () => {
    const weights = new Map<string, number>([
      ['packages/a/tests/heavy-1.spec.ts', 100],
      ['packages/a/tests/heavy-2.spec.ts', 90],
      ['packages/a/tests/heavy-3.spec.ts', 80],
      ['packages/a/tests/light.spec.ts', 1],
    ])
    const buckets = assignWeightedPartitions([...weights.keys()], weights, 3)
    expect(buckets).toHaveLength(3)
    for (const bucket of buckets) {
      expect(bucket).not.toHaveLength(0)
      expect(bucket.filter(file => file.includes('heavy'))).toHaveLength(1)
    }
  })

  it('balances total weight across partitions', () => {
    const files = Array.from({ length: 20 }, (_, index) => `packages/a/tests/file-${index}.spec.ts`)
    const weights = new Map(files.map((file, index) => [file, (index % 7) + 1]))
    const buckets = assignWeightedPartitions(files, weights, 4)
    const sums = buckets.map(bucket => bucket.reduce((sum, file) => sum + (weights.get(file) ?? 0), 0))
    const spread = Math.max(...sums) - Math.min(...sums)
    expect(spread).toBeLessThanOrEqual(7)
  })

  it('steers assignment by weight, not by file count', () => {
    // Weight-aware LPT balances three buckets to 1500 each. A file-count-only
    // rule pairs the heaviest file with the fourth (1700), so the assertion
    // only passes when recorded weights steer the assignment.
    const weights = new Map<string, number>([
      ['a.spec.ts', 1000],
      ['b.spec.ts', 900],
      ['c.spec.ts', 800],
      ['d.spec.ts', 700],
      ['e.spec.ts', 600],
      ['f.spec.ts', 500],
    ])
    const buckets = assignWeightedPartitions([...weights.keys()], weights, 3)
    const sums = buckets.map(bucket => bucket.reduce((sum, file) => sum + (weights.get(file) ?? 0), 0))
    expect(Math.max(...sums)).toBeLessThanOrEqual(1550)
  })

  it('leaves trailing empty buckets when files are scarce', () => {
    const files = ['a.spec.ts', 'b.spec.ts']
    const buckets = assignWeightedPartitions(files, new Map(), 4)
    expect(buckets.map(bucket => bucket.length).sort()).toEqual([0, 0, 1, 1])
  })

  it('returns one empty bucket per partition for an empty inventory', () => {
    expect(assignWeightedPartitions([], new Map(), 3)).toEqual([[], [], []])
  })

  it('assigns unknown-weight files evenly', () => {
    const files = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts']
    const buckets = assignWeightedPartitions(files, new Map(), 2)
    expect(buckets.map(bucket => bucket.length).sort()).toEqual([2, 2])
  })
})
