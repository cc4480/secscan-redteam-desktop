/** Worker-pool cases: bounded concurrency, input ordering, and retry placement in `runMigrationJobs`. */

import { describe, expect, it } from 'vitest'
import { runMigrationJobs } from './migrate-sessions-to-v4.ts'

describe('one-time V4 migration command', () => {
  it('bounds active jobs and retries changed-source inputs only after the initial pass drains', async () => {
    const entered = Array.from({ length: 4 }, () => Promise.withResolvers<undefined>())
    const release = Array.from({ length: 4 }, () => Promise.withResolvers<undefined>())
    const initial: number[] = []
    const retries: number[] = []
    let active = 0
    let peak = 0
    const task = runMigrationJobs(4, 2, async (index, retry) => {
      if (retry) {
        expect(active).toBe(0)
        expect(initial.toSorted()).toEqual([0, 1, 2, 3])
        retries.push(index)
        return false
      }
      active += 1
      peak = Math.max(peak, active)
      entered[index]!.resolve(undefined)
      await release[index]!.promise
      active -= 1
      initial.push(index)
      return index === 0
    })
    try {
      await Promise.all([entered[0]!.promise, entered[1]!.promise])
      expect(active).toBe(2)
      release[1]!.resolve(undefined)
      await entered[2]!.promise
      expect(active).toBe(2)
      release[0]!.resolve(undefined)
      await entered[3]!.promise
      expect(active).toBe(2)
      expect(retries).toEqual([])
      release[2]!.resolve(undefined)
      release[3]!.resolve(undefined)
      await task
      expect(peak).toBe(2)
      expect(retries).toEqual([0])
    } finally {
      for (const barrier of release) barrier.resolve(undefined)
      await task
    }
  })

  it('runs each input to completion before starting the next with one job', async () => {
    const order: string[] = []
    await runMigrationJobs(3, 1, async (index, retry) => {
      expect(retry).toBe(false)
      order.push(`start ${index}`)
      await Promise.resolve()
      order.push(`end ${index}`)
      return false
    })
    expect(order).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2'])
  })

  it('drains ten thousand immediate inputs without exceeding the worker limit', async () => {
    const visits = new Uint8Array(10_000)
    let active = 0
    let peak = 0
    await runMigrationJobs(visits.length, 16, async (index, retry) => {
      expect(retry).toBe(false)
      visits[index]! += 1
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return false
    })
    expect(visits.every(count => count === 1)).toBe(true)
    expect(peak).toBe(16)
    expect(active).toBe(0)
  })
})
