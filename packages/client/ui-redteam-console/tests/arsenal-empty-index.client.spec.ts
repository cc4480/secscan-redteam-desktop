// @vitest-environment jsdom
/**
 * The Arsenal page over an empty index (FIX-CONSOLE-PAGES).
 *
 * The Arsenal tools answer an empty index with a typed envelope —
 * { error: { code: 'ARSENAL_INDEX_EMPTY', fix } } — and the Phase 0 bridge
 * delivers that envelope as a successful payload. The controller used to
 * hand it to browseLoaded, so the page rendered a census with zero topics
 * and a stray "Back to topics" card (Carlos's live screenshot, 2026-11-01)
 * instead of the honest failure state that names the fix. These specs pin
 * the envelope to the failed states for browse and for search/recommend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleApi, ConsoleResult } from '../src/client/api.ts'
import { createArsenalController } from '../src/client/arsenal-face.ts'
import { scriptedConsole } from './fixtures.client.ts'

const EMPTY_INDEX = {
  error: { code: 'ARSENAL_INDEX_EMPTY', fix: 'Run: redteam-runner arsenal refresh' },
  index: null,
}

/** Flush the microtask queue without touching fake timers. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('arsenal over an empty index', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('browse lands the typed empty-index failure, not an empty census', async () => {
    const scripted = scriptedConsole()
    const api: ConsoleApi = {
      ...scripted.api,
      arsenal: vi.fn(async () => ({ ok: true, value: EMPTY_INDEX }) as ConsoleResult<never>) as ConsoleApi['arsenal'],
    }
    const controller = createArsenalController(api)
    controller.face.start()
    await flush()
    const state = () => controller.face.hooks.arsenal.getSnapshot()
    expect(state().browse).toMatchObject({ kind: 'failed', message: 'Run: redteam-runner arsenal refresh' })
    controller.dispose()
  })

  it('search lands the same failure in the results state', async () => {
    const scripted = scriptedConsole()
    const api: ConsoleApi = {
      ...scripted.api,
      arsenal: vi.fn(async () => ({ ok: true, value: EMPTY_INDEX }) as ConsoleResult<never>) as ConsoleApi['arsenal'],
    }
    const controller = createArsenalController(api)
    controller.face.start()
    await flush()
    controller.face.search('idor')
    await flush()
    const state = () => controller.face.hooks.arsenal.getSnapshot()
    expect(state().results).toMatchObject({ kind: 'failed', message: 'Run: redteam-runner arsenal refresh' })
    controller.dispose()
  })
})
