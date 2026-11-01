/**
 * Browser half: register the RedTeam console surfaces in the chat client.
 *
 * Phase 1 (Q-CONSOLE-MERGE) is the `watch` right-Sidebar tab type, on the
 * public two-stage path: the type into `ctx.sidebarRightTabs`, the body
 * into the keyed `sidebar.right.pane.tab` seat and the chip title into the
 * keyed `sidebar.right.pane.tab.title` seat, both under the type's `id`.
 * Later phases add the Engagements main panel and the Foundry / Arsenal /
 * Reports / Scope surfaces to this same package.
 *
 * The file split is the layering: what the type IS (`definition.ts`), what
 * it keeps (`store.ts`), how it talks to the console (`api.ts`), what it
 * does (`face.ts`), what it draws (`WatchBody.tsx`, `FeedList.tsx`,
 * `Controls.tsx`, `WatchTitle.tsx`), what it says (`locales.ts`), and this
 * module, which only wires them together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createConsoleApi } from './api.ts'
import { WATCH_ID, watchDefinition } from './definition.ts'
import { watchFace } from './face.ts'
import { en, zh } from './locales.ts'
import { createWatchStore } from './store.ts'
import { WatchBody } from './WatchBody.tsx'
import { WatchTitle } from './WatchTitle.tsx'

export type { RedteamConsoleKey } from './locales.ts'
export type { FeedStatus, ListState, WatchState, WatchTabState } from './store.ts'
export type { WatchInjected } from './face.ts'
export type { WatchBodyProps } from './WatchBody.tsx'

/** This package's copy namespace. */
const NS = 'redteamConsole'

/**
 * Required browser services: the slot registry, copy, and the right
 * Sidebar's tab registry.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body: register the watch type, its dictionaries, its body,
 * and its chip title.
 * @param ctx - client root context carrying the registry, the slots, and copy.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(watchDefinition(t)), 'ui-redteam-console: watch type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-redteam-console: dictionaries')

  const store = createWatchStore()
  const inject = watchFace(createConsoleApi())
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: WATCH_ID, locale: NS, store, inject },
    WatchBody,
  )), 'ui-redteam-console: watch tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: WATCH_ID },
    WatchTitle,
  )), 'ui-redteam-console: watch tab title')
}
