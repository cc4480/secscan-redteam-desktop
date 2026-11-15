/**
 * CI worker budget fixtures: the concurrency and environment a CI gate mode hands to its consumer
 * processes.
 */
import { describe, expect, it } from 'vitest'
import { ciWorkerEnvironment, defaultConcurrency } from './run-gates.ts'

describe('CI worker allocation', () => {
  it.each([1, 2, 4, 8, 16, 64])('shares a %i CPU coverage budget without multiplying pools', (cpus) => {
    const env = ciWorkerEnvironment('ci-coverage', {}, cpus)
    const exempt = Math.max(1, Math.floor(cpus / 3))
    const instrumented = Number(env.DSH_COVERAGE_PARTITIONS ?? 1)
    expect(Number(env.DSH_COVERAGE_MAX_WORKERS)).toBe(cpus)
    expect(instrumented + exempt).toBe(Math.max(2, cpus))
    expect(defaultConcurrency('ci-coverage', 3, cpus).workers).toBe(Math.min(3, cpus))
    if (cpus <= 2) expect(env.DSH_COVERAGE_PARTITIONS).toBeUndefined()
  })

  it('bounds overlapping readers and lets the isolated browser pool use the runner', () => {
    const env = ciWorkerEnvironment('ci-consumers', {}, 16)
    expect(env).toMatchObject({
      DSH_OXLINT_THREADS: '8',
      DSH_PUBLINT_CONCURRENCY: '8',
      DSH_SNAPSHOT_MAX_WORKERS: '1',
      DSH_SNAPSHOT_MAX_CONCURRENCY: '8',
      DSH_WEB_SNAPSHOT_WORKERS: '16',
    })
  })

  it('preserves serial reference overrides on large hosts', () => {
    const inherited = {
      DSH_GATE_CONCURRENCY: '1',
      DSH_COVERAGE_MAX_WORKERS: '1',
      DSH_OXLINT_THREADS: '1',
      DSH_PUBLINT_CONCURRENCY: '1',
      DSH_SNAPSHOT_MAX_CONCURRENCY: '1',
      DSH_WEB_SNAPSHOT_WORKERS: '1',
    }
    const additions = ciWorkerEnvironment('ci-primary', inherited, 64)
    expect(additions).toEqual({ DSH_SNAPSHOT_MAX_WORKERS: '1' })
    expect(inherited.DSH_COVERAGE_MAX_WORKERS).toBe('1')
  })

  it('honors an explicit coverage budget and partition override', () => {
    expect(ciWorkerEnvironment('ci-coverage', { DSH_COVERAGE_MAX_WORKERS: '6' }, 16))
      .toHaveProperty('DSH_COVERAGE_PARTITIONS', '4')
    expect(ciWorkerEnvironment('ci-coverage', { DSH_COVERAGE_PARTITIONS: '3' }, 16))
      .not.toHaveProperty('DSH_COVERAGE_PARTITIONS')
  })

  it.each(['0', '-1', 'NaN', '2.5'])('rejects invalid worker budget %s', (raw) => {
    expect(() => ciWorkerEnvironment('ci-coverage', { DSH_COVERAGE_MAX_WORKERS: raw }, 16))
      .toThrow('DSH_COVERAGE_MAX_WORKERS must be a positive integer')
  })

  it('keeps local documentation defaults unchanged', () => {
    expect(ciWorkerEnvironment('doc-sync', {}, 64)).toEqual({})
  })
})
