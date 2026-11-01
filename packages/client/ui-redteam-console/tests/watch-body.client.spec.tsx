// @vitest-environment jsdom
/**
 * The Watch body over a real store and face with a scripted console: the
 * engagement's OWN numbers on the stat cards (never the chat session's),
 * the roster, the feed as events arrive, and the controls' safety
 * semantics — named operator required, abort reason prefilled, outcomes
 * in the console's words.
 */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { watchFace } from '../src/client/face.ts'
import { en } from '../src/client/locales.ts'
import { createWatchStore } from '../src/client/store.ts'
import { WatchBody } from '../src/client/WatchBody.tsx'
import type { WatchBodyProps } from '../src/client/WatchBody.tsx'
import { feedEvent, LIVE_ENGAGEMENT, scriptedConsole } from './fixtures.client.ts'
import type { ScriptedConsole } from './fixtures.client.ts'

const SESSION = 's-test' as SessionId
const TAB = 'tab-1' as TabId

afterEach(() => { cleanup() })

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

interface Mounted {
  readonly view: RenderResult
  readonly scripted: ScriptedConsole
}

function mount(): Mounted {
  const instance = createWatchStore().create()
  const scripted = scriptedConsole()
  const face = watchFace(scripted.api)(SESSION, instance.actions)
  const controller = new AbortController()
  const props = {
    useTabInfo: () => ({
      tab: { id: TAB, signal: controller.signal, actions: {} },
    }),
    useStore: hookOf(instance),
    actions: instance.actions,
    ...face,
    t: makeTranslate(en),
  }
  const view = render(<WatchBody {...props as unknown as WatchBodyProps} />)
  return { view, scripted }
}

describe('WatchBody', () => {
  it('shows the engagement\'s own stats, details, and roster once the list lands', async () => {
    const { view } = mount()
    expect(await view.findByText('1,234,567')).toBeTruthy()
    expect(view.getByText('in 1,000,000 · out 234,567')).toBeTruthy()
    expect(view.getByText('54')).toBeTruthy()
    expect(view.getByText('3/8 proven')).toBeTruthy()
    expect(view.getByText(LIVE_ENGAGEMENT.target)).toBeTruthy()
    expect(view.getByText('12 · proven 3, clear 9')).toBeTruthy()
    expect(view.getByText('secscan, seclayer')).toBeTruthy()
    expect(view.getByText('coordinator')).toBeTruthy()
    expect(view.getAllByText('meta · muse-spark-1.3')).toHaveLength(5)
    expect(view.getAllByText('No activity yet')).toHaveLength(5)
  })

  it('renders feed events as they arrive and marks the actor\'s roster activity', async () => {
    const { view, scripted } = mount()
    await view.findByText('1,234,567')
    const feed = scripted.feeds[0]!
    act(() => {
      feed.emitState({ status: 'running', phase: 'exploit', eventCount: 1 })
      feed.emitEvent(feedEvent(1))
    })
    expect(await view.findByText('http_probe')).toBeTruthy()
    expect(view.getByText('Live')).toBeTruthy()
    expect(view.getByText('http_probe — 200 OK')).toBeTruthy()
  })

  it('aborts with the prefilled audit reason and shows the console\'s outcome', async () => {
    const { view, scripted } = mount()
    await view.findByText('1,234,567')
    fireEvent.click(view.getByText('Abort engagement'))
    const reason = view.getByLabelText('Abort reason (recorded in the audit log)') as HTMLInputElement
    expect(reason.value).toBe('operator abort from UI')
    fireEvent.click(view.getByText('Abort now'))
    expect(scripted.aborts).toEqual([{ id: LIVE_ENGAGEMENT.id, reason: 'operator abort from UI' }])
    expect(await view.findByText('abort signal written')).toBeTruthy()
  })

  it('refuses a tier change without a named operator, then posts it with one', async () => {
    const { view, scripted } = mount()
    await view.findByText('1,234,567')
    fireEvent.click(view.getByText('Change tier'))
    // The draft's confirm carries the same label as the opener; it is the second one.
    fireEvent.click(view.getAllByText('Change tier')[1]!)
    expect(view.getByText('A named operator is required — someone must own the tier change.')).toBeTruthy()
    expect(scripted.escalates).toEqual([])
    fireEvent.change(view.getByLabelText('Operator name (recorded in the approval log)'), { target: { value: 'carlos' } })
    fireEvent.click(view.getAllByText('Change tier')[1]!)
    expect(scripted.escalates).toEqual([{
      id: LIVE_ENGAGEMENT.id,
      input: { tier: '1', operator: 'carlos', reason: '' },
    }])
    expect(await view.findByText('tier set to 1')).toBeTruthy()
  })

  it('shows the Tier-2 production note only when Tier 2 is chosen', async () => {
    const { view } = mount()
    await view.findByText('1,234,567')
    fireEvent.click(view.getByText('Change tier'))
    expect(view.queryByText(/explicit Tier-2 approval/)).toBeNull()
    fireEvent.change(view.getByLabelText('Autonomy tier'), { target: { value: '2' } })
    expect(view.getByText(/explicit Tier-2 approval/)).toBeTruthy()
  })
})
