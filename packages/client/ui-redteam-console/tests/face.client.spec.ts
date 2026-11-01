// @vitest-environment jsdom
/**
 * The watch face's behavior through the real store: the poll cadence and
 * its visibility pause, selection resolution, the feed's append and
 * dedupe, the single reconnect, and the control outcomes — every rule the
 * performance guardrail and the console's safety semantics impose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { watchFace } from '../src/client/face.ts'
import { createWatchStore } from '../src/client/store.ts'
import { DONE_ENGAGEMENT, feedEvent, LIVE_ENGAGEMENT, scriptedConsole } from './fixtures.client.ts'
import type { ScriptedConsole } from './fixtures.client.ts'

const SESSION = 's-1' as SessionId
const TAB = 'tab-1' as TabId

/** Flush the microtask queue (promise settlements) without touching fake timers. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

function mount() {
  const instance = createWatchStore().create()
  const scripted: ScriptedConsole = scriptedConsole()
  const face = watchFace(scripted.api)(SESSION, instance.actions)
  const controller = new AbortController()
  return {
    scripted,
    face,
    controller,
    snapshot: () => instance.getSnapshot().byTab[TAB],
  }
}

/** Drive document visibility for the pause checks. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('watchFace', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    setHidden(false)
  })

  it('loads the list, selects the live engagement first, and opens its feed', async () => {
    const { scripted, face, controller, snapshot } = mount()
    face.start(TAB, controller.signal)
    await flush()
    const state = snapshot()!
    expect(state.list.kind).toBe('ready')
    expect(state.selectedId).toBe(LIVE_ENGAGEMENT.id)
    expect(state.seats).toHaveLength(5)
    expect(scripted.feeds).toHaveLength(1)
    expect(scripted.feeds[0]).toMatchObject({ id: LIVE_ENGAGEMENT.id, after: 0 })
    expect(state.feedStatus).toBe('connecting')
    scripted.feeds[0]!.emitState({ status: 'running', phase: 'exploit', eventCount: 3 })
    expect(snapshot()!.feedStatus).toBe('live')
    expect(snapshot()!.live).toEqual({ status: 'running', phase: 'exploit', eventCount: 3 })
  })

  it('polls on the cadence, pauses whole cycles while hidden, and refreshes seats slowly', async () => {
    const { scripted, face, controller } = mount()
    face.start(TAB, controller.signal)
    await flush()
    expect(scripted.listCalls).toBe(1)
    expect(scripted.modelsCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(scripted.listCalls).toBe(2)
    setHidden(true)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(scripted.listCalls).toBe(2)
    setHidden(false)
    await flush()
    expect(scripted.listCalls).toBe(3)
    // Seats refresh on the eighth poll cycle after the return cycle.
    await vi.advanceTimersByTimeAsync(4_000 * 7)
    expect(scripted.modelsCalls).toBe(2)
  })

  it('appends feed events in order and drops duplicates by seq', async () => {
    const { scripted, face, controller, snapshot } = mount()
    face.start(TAB, controller.signal)
    await flush()
    const feed = scripted.feeds[0]!
    feed.emitEvent(feedEvent(1))
    feed.emitEvent(feedEvent(2, { action: 'finding_proven' }))
    feed.emitEvent(feedEvent(2, { action: 'finding_proven' }))
    feed.emitEvent(feedEvent(1))
    expect(snapshot()!.feed.map(event => event.seq)).toEqual([1, 2])
  })

  it('reconnects once from the last seq when a fresh stream breaks mid-run', async () => {
    const { scripted, face, controller, snapshot } = mount()
    face.start(TAB, controller.signal)
    await flush()
    scripted.feeds[0]!.emitEvent(feedEvent(7))
    scripted.feeds[0]!.emitError()
    expect(snapshot()!.feedStatus).toBe('failed')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(scripted.feeds).toHaveLength(2)
    expect(scripted.feeds[1]).toMatchObject({ id: LIVE_ENGAGEMENT.id, after: 7 })
    // A resumed stream that breaks stays down — no reconnect loop.
    scripted.feeds[1]!.emitError()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(scripted.feeds).toHaveLength(2)
  })

  it('marks the feed ended on done and refreshes the list', async () => {
    const { scripted, face, controller, snapshot } = mount()
    face.start(TAB, controller.signal)
    await flush()
    scripted.feeds[0]!.emitDone('complete')
    expect(snapshot()!.feedStatus).toBe('ended')
    await flush()
    expect(scripted.listCalls).toBe(2)
  })

  it('settles an abort into the store and refreshes; a failure records its message', async () => {
    const { scripted, face, controller, snapshot } = mount()
    face.start(TAB, controller.signal)
    await flush()
    face.abort(TAB, LIVE_ENGAGEMENT.id, 'operator abort from UI')
    await flush()
    expect(scripted.aborts).toEqual([{ id: LIVE_ENGAGEMENT.id, reason: 'operator abort from UI' }])
    expect(snapshot()!.controlNote).toBe('abort signal written')
    expect(snapshot()!.controlOk).toBe(true)
    scripted.setAbort({ ok: false, message: 'console gone' })
    face.abort(TAB, LIVE_ENGAGEMENT.id, 'again')
    await flush()
    expect(snapshot()!.controlError).toBe('console gone')
    expect(snapshot()!.controlOk).toBe(false)
  })

  it('switching the selection closes the old feed and opens the new one', async () => {
    const { scripted, face, controller, snapshot } = mount()
    face.start(TAB, controller.signal)
    await flush()
    face.select(TAB, DONE_ENGAGEMENT.id)
    expect(scripted.feeds[0]!.closed).toBe(true)
    expect(scripted.feeds).toHaveLength(2)
    expect(scripted.feeds[1]).toMatchObject({ id: DONE_ENGAGEMENT.id, after: 0 })
    expect(snapshot()!.selectedId).toBe(DONE_ENGAGEMENT.id)
    expect(snapshot()!.feed).toEqual([])
  })

  it('tearing the tab down stops the poll, the feed, and the store bucket', async () => {
    const { scripted, face, controller, snapshot } = mount()
    face.start(TAB, controller.signal)
    await flush()
    controller.abort()
    expect(scripted.feeds[0]!.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(scripted.listCalls).toBe(1)
    expect(snapshot()).toBeUndefined()
  })

  it('a failed list lands in the failed state with the console\'s message', async () => {
    const { scripted, face, controller, snapshot } = mount()
    scripted.setList({ ok: false, message: 'console not running' })
    face.start(TAB, controller.signal)
    await flush()
    expect(snapshot()!.list).toEqual({ kind: 'failed', message: 'console not running' })
  })
})
