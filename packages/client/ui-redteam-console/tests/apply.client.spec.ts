/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The tab registry is real, because "registered" means what it says a type
 * is; the slot and locale faces are recorders, because what matters here is
 * what was handed to them — one body seat under the type's id with its
 * store and face, one title seat — and that every registration is gone
 * after dispose, which is what makes a reload safe.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { WATCH_ID, WATCH_KIND } from '../src/client/definition.ts'
import { apply, inject, PANEL_ID } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { EngagementsPage } from '../src/client/EngagementsPage.tsx'
import { en, zh } from '../src/client/locales.ts'
import { PanelIcon } from '../src/client/PanelIcon.tsx'
import { WatchBody } from '../src/client/WatchBody.tsx'
import { WatchTitle } from '../src/client/WatchTitle.tsx'

interface Recorded {
  name: string
  key: string | undefined
  id: string | undefined
  locale: string | undefined
  store: unknown
  inject: unknown
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    // Copy is the dictionary's contract; the key stands in for the translation.
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, tabs, registered, dictionaries, fiber }
}

describe('ui-redteam-console apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body and title seats under the type\'s id', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(WATCH_KIND)
    expect(definition?.id).toBe(WATCH_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.title()).toBe('tab.watch.title')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()]))
      .toEqual([[40, 'guide.watch.title', 'guide.watch.description']])
    expect(dictionaries.get('redteamConsole')).toEqual({ zh, en })
    // The seat key is the implementation's id, not the kind: an extension may
    // take the kind over, and the seat must still find this body.
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', WATCH_ID, 'redteamConsole', WatchBody],
      ['sidebar.right.pane.tab.title', WATCH_ID, undefined, WatchTitle],
      ['main', PANEL_ID, 'redteamConsole', EngagementsPage],
      ['sidebar.panellist', undefined, 'redteamConsole', PanelIcon],
    ])
    expect(registered[3]!.id).toBe(PANEL_ID)
    const body = registered[0]!
    expect(body.store).toBeDefined()
    // The seat's inject is the slot factory: (sessionId, actions) => face.
    expect(typeof body.inject).toBe('function')
    const face = (body.inject as (sessionId: string, actions: unknown) => object)('s-1', {})
    expect(Object.keys(face).sort()).toEqual(['abort', 'escalate', 'refresh', 'select', 'start'])
    // The panel's inject factory returns the controller's face, hooks included.
    const panelFace = (registered[2]!.inject as () => { hooks: object })()
    expect(Object.keys(panelFace.hooks)).toEqual(['engagements'])
  })

  it('removes every registration when the plugin fiber disposes', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(WATCH_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})
