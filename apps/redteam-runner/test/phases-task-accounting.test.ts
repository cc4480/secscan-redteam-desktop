/**
 * Parallel fan-out accounting.
 *
 * The defect this pins shut: red mode fans out three tasks against ONE shared
 * `ctx`, and each task snapshotted `ctx.probesUsed` / `ctx.liveFindings.length`
 * before and after its own run. Because the tasks overlap, every task's "after"
 * already included its siblings' work — so each reported their probes and findings
 * as its own, and those numbers are what the coordinator re-plans from.
 *
 * The rule: a chunk's delta is attributed once, and the results say so.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileChunkDeltas, type TaskResult } from '../src/phases/tasks.js'

function result(over: Partial<TaskResult>): TaskResult {
  return {
    task: { id: 't', kind: 'exploit', brief: 'b' },
    summary: 's',
    probesBefore: 0, probesAfter: 0,
    findingsBefore: 0, findingsAfter: 0,
    killedBefore: 0, killedAfter: 0,
    ...over,
  } as TaskResult
}

const totalOf = (rs: TaskResult[], key: 'probes' | 'findings' | 'killed'): number =>
  rs.reduce((sum, r) => sum + ((r[`${key}After` as const] as number) - (r[`${key}Before` as const] as number)), 0)

describe('parallel chunk accounting', () => {
  it('counts the chunk delta once instead of once per overlapping task', () => {
    // All three tasks started at 10 probes and finished at 16: without
    // reconciliation each would report +6 and the coordinator would read +18.
    const chunk = [
      result({ probesBefore: 10, probesAfter: 16, findingsBefore: 0, findingsAfter: 2 }),
      result({ probesBefore: 11, probesAfter: 16, findingsBefore: 0, findingsAfter: 2 }),
      result({ probesBefore: 12, probesAfter: 16, findingsBefore: 1, findingsAfter: 2 }),
    ]
    reconcileChunkDeltas(chunk)
    assert.equal(totalOf(chunk, 'probes'), 6, 'the chunk probed 6 times, not 18')
    assert.equal(totalOf(chunk, 'findings'), 2, 'the chunk confirmed 2 findings, not 6')
  })

  it('marks every result in the chunk as shared', () => {
    const chunk = [
      result({ probesBefore: 5, probesAfter: 9 }),
      result({ probesBefore: 5, probesAfter: 9 }),
    ]
    reconcileChunkDeltas(chunk)
    assert.deepEqual(chunk.map((r) => r.attribution), ['shared', 'shared'])
  })

  it('gives the attributed task the whole chunk delta and the siblings none', () => {
    const chunk = [
      result({ probesBefore: 5, probesAfter: 9 }),
      result({ probesBefore: 6, probesAfter: 9 }),
    ]
    reconcileChunkDeltas(chunk)
    assert.equal(chunk[0]!.probesAfter - chunk[0]!.probesBefore, 4)
    assert.equal(chunk[1]!.probesAfter - chunk[1]!.probesBefore, 0)
  })

  it('leaves a serial task exact — nothing to reconcile', () => {
    // runBatch only reconciles chunks of more than one; a lone result keeps its
    // own measurement and stays unflagged.
    const single = result({ probesBefore: 3, probesAfter: 7 })
    assert.equal(single.attribution, undefined)
    assert.equal(single.probesAfter - single.probesBefore, 4)
  })
})
