/**
 * Gate graph validation: malformed graphs and worker counts are rejected before a child starts,
 * and prerequisites gate their dependents and followers.
 */
import { describe, expect, it, vi } from 'vitest'
import { runGates, type Gate } from './run-gates.ts'
import { gate, resultFor } from './run-gates-test-support.ts'

describe('gate graph validation', () => {
  it.each([
    ['empty', [], /gate graph has no gates/],
    ['duplicate ids', [gate('same'), gate('same')], /duplicate gate id "same"/],
    ['unknown dependencies', [gate('subject', { needs: ['missing'] })], /depends on unknown gate "missing"/],
    ['unknown ordering predecessors', [gate('subject', { after: ['missing'] })], /waits for unknown gate "missing"/],
    ['cycles', [gate('first', { needs: ['second'] }), gate('second', { needs: ['first'] })], /dependency cycle: first -> second -> first/],
    ['mixed cycles', [gate('first', { after: ['second'] }), gate('second', { needs: ['first'] })], /dependency cycle: first -> second -> first/],
  ] as const)('rejects %s before starting a child', async (_label, invalid, message) => {
    const execute = vi.fn((subject: Gate) => Promise.resolve(resultFor(subject)))

    await expect(runGates([...invalid], 1, execute)).rejects.toThrow(message)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an invalid worker count before starting a child', async () => {
    const execute = vi.fn((subject: Gate) => Promise.resolve(resultFor(subject)))

    await expect(runGates([gate('subject')], 0, execute)).rejects.toThrow('max concurrency must be a positive integer')
    expect(execute).not.toHaveBeenCalled()
  })

  it('skips dependents after their prerequisite fails', async () => {
    const dependent = gate('dependent', { needs: ['root'] })
    const root = gate('root')
    const execute = vi.fn((subject: Gate) => Promise.resolve(resultFor(subject, 'failed')))

    const results = await runGates([dependent, root], 1, execute)

    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(root, undefined)
    expect(results[0]).toMatchObject({ gate: dependent, status: 'skipped', error: 'dependency failed or skipped: root' })
  })

  it('runs an ordered follower after its predecessor fails', async () => {
    const follower = gate('follower', { after: ['root'] })
    const root = gate('root')
    const execute = vi.fn((subject: Gate) => Promise.resolve(resultFor(subject, subject === root ? 'failed' : 'passed')))

    const results = await runGates([follower, root], 2, execute)

    expect(execute.mock.calls.map(([subject]) => subject.id)).toEqual(['root', 'follower'])
    expect(results.map(result => result.status)).toEqual(['passed', 'failed'])
  })

  it('runs an ordered follower after its predecessor is skipped', async () => {
    const follower = gate('follower', { after: ['dependent'] })
    const dependent = gate('dependent', { needs: ['root'] })
    const root = gate('root')
    const execute = vi.fn((subject: Gate) => Promise.resolve(resultFor(subject, subject === root ? 'failed' : 'passed')))

    const results = await runGates([follower, dependent, root], 2, execute)

    expect(execute.mock.calls.map(([subject]) => subject.id)).toEqual(['root', 'follower'])
    expect(results.map(result => result.status)).toEqual(['passed', 'skipped', 'failed'])
  })
})
