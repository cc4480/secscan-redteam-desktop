/**
 * Foundry loop-state loader tests (once-over DB-2).
 *
 * loadLoopState must distinguish "no state yet" from "state is broken":
 * an absent loop-state.json reads as zero cycles, but a file that exists
 * and cannot be parsed (or has an unrecognized shape) throws — reading it
 * as zero lets the next saveLoopState overwrite the real cycle history
 * and reuse cycle numbers. Mirrors the D3 registry treatment in store.ts.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadLoopState, saveLoopState } from '../src/foundry/loop-state.js'

function tmpStore(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('foundry loop-state loader (DB-2)', () => {
  it('missing loop-state.json reads as fresh zero state', () => {
    const store = tmpStore('loop-state-missing-')
    assert.deepEqual(loadLoopState(store), { cyclesRun: 0, lastCycle: null, fitness: {} })
  })

  it('a valid saved state loads back intact', () => {
    const store = tmpStore('loop-state-valid-')
    saveLoopState(store, {
      cyclesRun: 7,
      lastCycle: null,
      fitness: {
        'case-1': {
          model: 'fitness-v1.1-live (in-app port)',
          fitness: 0.5,
          components: {
            discrimination: null,
            difficultyFit: null,
            novelty: null,
            liveSimilarity: null,
            coverageGain: null,
            costEfficiency: null,
          },
          scoredWeight: 1,
          at: '2026-11-01T00:00:00.000Z',
        },
      },
    })
    const loaded = loadLoopState(store)
    assert.equal(loaded.cyclesRun, 7)
    assert.equal(loaded.lastCycle, null)
    assert.deepEqual(Object.keys(loaded.fitness), ['case-1'])
  })

  it('a store path under a non-directory reads as fresh zero state', () => {
    const root = tmpStore('loop-state-notdir-')
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'x')
    assert.deepEqual(loadLoopState(join(blocker, 'foundry-store')), { cyclesRun: 0, lastCycle: null, fitness: {} })
  })

  it('a corrupt loop-state.json throws instead of reading as zero cycles', () => {
    const store = tmpStore('loop-state-corrupt-')
    writeFileSync(join(store, 'loop-state.json'), '{"cyclesRun": 7, "fitness": {"case-1":')
    assert.throws(() => loadLoopState(store), /loop state at .* is not valid JSON — refusing to read it as zero cycles/)
  })

  it('a wrong-shape loop-state.json throws instead of reading as zero cycles', () => {
    const store = tmpStore('loop-state-shape-')
    writeFileSync(join(store, 'loop-state.json'), JSON.stringify({ hello: 'world' }))
    assert.throws(() => loadLoopState(store), /unrecognized shape .* refusing to read it as zero cycles/)
  })
})
