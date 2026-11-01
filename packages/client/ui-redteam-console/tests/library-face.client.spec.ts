// @vitest-environment jsdom
/**
 * The Phase 3 controllers over a scripted console: Foundry loads its
 * state and fires gate actions that settle back into the store; the
 * Scope aggregate loads; the Arsenal census/search flow through the
 * bridge calls; the Reports library prefers finished engagements and
 * lands the selected one's completion record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createArsenalController, createReportsController } from '../src/client/arsenal-face.ts'
import { createFoundryController, createScopeController } from '../src/client/foundry-face.ts'
import { DONE_ENGAGEMENT, LIVE_ENGAGEMENT, scriptedConsole } from './fixtures.client.ts'
import type { ScriptedConsole } from './fixtures.client.ts'

/** Flush the microtask queue without touching fake timers. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('phase 3 controllers', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('foundry loads state, fires verify, and lands its totals', async () => {
    const scripted: ScriptedConsole = scriptedConsole()
    const controller = createFoundryController(scripted.api)
    controller.face.start()
    await flush()
    const state = () => controller.face.hooks.foundry.getSnapshot()
    expect(state().section).toMatchObject({ kind: 'ready' })
    controller.face.act('verify')
    await flush()
    expect(scripted.foundryActions).toEqual(['verify'])
    expect(state().action).toMatchObject({ kind: 'done', action: 'verify' })
    controller.dispose()
  })

  it('scope loads the aggregate', async () => {
    const scripted = scriptedConsole()
    const controller = createScopeController(scripted.api)
    controller.face.start()
    await flush()
    expect(controller.face.hooks.scope.getSnapshot().section).toMatchObject({
      kind: 'ready',
      value: { totals: { denials: 4 } },
    })
    controller.dispose()
  })

  it('arsenal browses the census, drills a topic, and searches', async () => {
    const scripted = scriptedConsole()
    const controller = createArsenalController(scripted.api)
    controller.face.start()
    await flush()
    const state = () => controller.face.hooks.arsenal.getSnapshot()
    expect(state().browse).toMatchObject({
      kind: 'ready',
      value: { topics: [{ topic: 'web', collections: 41, entries: 700 }, { topic: 'wordlists', collections: 10, entries: 226 }] },
    })
    controller.face.browse('web')
    await flush()
    expect(scripted.arsenalCalls.at(-1)).toEqual({ tool: 'arsenal_browse', args: { category: 'web' } })
    expect(state().browse).toMatchObject({ kind: 'ready', value: { collections: [{ slug: 'gtfobins' }] } })
    controller.face.search('idor')
    await flush()
    expect(scripted.arsenalCalls.at(-1)).toEqual({ tool: 'arsenal_search', args: { query: 'idor', limit: 25 } })
    expect(state().results).toMatchObject({ kind: 'ready', value: { total: 1 } })
    controller.dispose()
  })

  it('reports prefers the finished engagement and lands its record', async () => {
    const scripted = scriptedConsole()
    const controller = createReportsController(scripted.api)
    controller.face.start()
    await flush()
    const state = () => controller.face.hooks.reports.getSnapshot()
    expect(state().selectedId).toBe(DONE_ENGAGEMENT.id)
    expect(state().detail).toMatchObject({ kind: 'ready' })
    if (state().detail?.kind === 'ready') {
      expect(Object.keys(state().detail.value.state?.deliverables ?? {})).toContain('report.md')
    }
    controller.face.select(LIVE_ENGAGEMENT.id)
    await flush()
    expect(state().detail).toMatchObject({ kind: 'ready', value: { live: true } })
    controller.dispose()
  })
})
