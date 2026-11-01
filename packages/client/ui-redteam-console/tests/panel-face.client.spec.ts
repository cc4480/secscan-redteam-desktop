// @vitest-environment jsdom
/**
 * The Engagements controller's behavior over a scripted console: list +
 * selection + section loads, selection switching, proof on demand, and
 * the reverify run — plan (no traffic) → execute (job) → the verdict
 * landing back on the finding. Polling exists only while started.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngagementsController } from '../src/client/panel-face.ts'
import type { EngagementsController } from '../src/client/panel-face.ts'
import {
  DONE_ENGAGEMENT, FINDING_WITH_PROOF, LIVE_ENGAGEMENT, scriptedConsole,
} from './fixtures.client.ts'
import type { ScriptedConsole } from './fixtures.client.ts'

/** Flush the microtask queue without touching fake timers. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

function mount(): { scripted: ScriptedConsole; controller: EngagementsController } {
  const scripted = scriptedConsole()
  const controller = createEngagementsController(scripted.api)
  return { scripted, controller }
}

const state = (controller: EngagementsController) => controller.face.hooks.engagements.getSnapshot()

describe('engagements controller', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('loads the list, selects the live engagement, and loads its sections', async () => {
    const { controller } = mount()
    controller.face.start()
    await flush()
    const snapshot = state(controller)
    expect(snapshot.list.kind).toBe('ready')
    expect(snapshot.selectedId).toBe(LIVE_ENGAGEMENT.id)
    expect(snapshot.findings).toMatchObject({ kind: 'ready' })
    expect(snapshot.coverage).toMatchObject({ kind: 'ready' })
    expect(snapshot.compliance).toMatchObject({ kind: 'ready' })
    controller.dispose()
  })

  it('switching the selection clears and reloads the sections', async () => {
    const { scripted, controller } = mount()
    controller.face.start()
    await flush()
    controller.face.select(DONE_ENGAGEMENT.id)
    expect(state(controller).selectedId).toBe(DONE_ENGAGEMENT.id)
    expect(state(controller).findings).toEqual({ kind: 'loading' })
    await flush()
    expect(state(controller).findings).toMatchObject({ kind: 'ready' })
    expect(scripted.api.findings).toHaveBeenCalledWith(DONE_ENGAGEMENT.id, expect.anything())
    controller.dispose()
  })

  it('fetches a proof bundle once, under its finding', async () => {
    const { scripted, controller } = mount()
    controller.face.start()
    await flush()
    controller.face.loadProof(FINDING_WITH_PROOF.id)
    await flush()
    expect(scripted.api.proof).toHaveBeenCalledWith(LIVE_ENGAGEMENT.id, 'F-1', expect.anything())
    expect(state(controller).proofByFinding['F-1']).toMatchObject({ kind: 'ready' })
    controller.dispose()
  })

  it('plans a reverify without executing, then executes and lands the verdict', async () => {
    const { scripted, controller } = mount()
    scripted.setJobs([
      { id: 'job-fixture-1', kind: 'reverify', status: 'running', startedAt: '2026-10-31T22:06:00.000Z' },
      {
        id: 'job-fixture-1', kind: 'reverify', status: 'done', startedAt: '2026-10-31T22:06:00.000Z',
        finishedAt: '2026-10-31T22:06:30.000Z', result: { verdict: 'still-vulnerable', summary: 'Fixture verdict summary.' },
      },
    ])
    controller.face.start()
    await flush()
    controller.face.planReverify('F-1')
    await flush()
    expect(scripted.reverifies).toEqual([{ id: LIVE_ENGAGEMENT.id, finding: 'F-1' }])
    expect(state(controller).reverifyByFinding['F-1']).toMatchObject({ kind: 'plan' })
    controller.face.executeReverify('F-1', ['fixture.invalid'])
    await flush()
    expect(scripted.reverifies[1]).toEqual({
      id: LIVE_ENGAGEMENT.id, finding: 'F-1', execute: true, scope: ['fixture.invalid'],
    })
    expect(state(controller).reverifyByFinding['F-1']).toEqual({ kind: 'executing', jobId: 'job-fixture-1' })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(state(controller).reverifyByFinding['F-1']).toEqual({
      kind: 'done', verdict: 'still-vulnerable', summary: 'Fixture verdict summary.',
    })
    controller.dispose()
  })

  it('stopping ends the list poll', async () => {
    const { scripted, controller } = mount()
    controller.face.start()
    await flush()
    expect(scripted.listCalls).toBe(1)
    controller.face.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(scripted.listCalls).toBe(1)
    controller.dispose()
  })

  it('refreshes the list on the open cadence only while started', async () => {
    const { scripted, controller } = mount()
    controller.face.start()
    await flush()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(scripted.listCalls).toBe(2)
    controller.dispose()
  })
})
