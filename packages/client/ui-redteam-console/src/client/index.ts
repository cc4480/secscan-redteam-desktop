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
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createConsoleApi } from './api.ts'
import { WATCH_ID, watchDefinition } from './definition.ts'
import { EngagementsPage } from './EngagementsPage.tsx'
import { watchFace } from './face.ts'
import { en, zh } from './locales.ts'
import { PanelIcon } from './PanelIcon.tsx'
import { createEngagementsController } from './panel-face.ts'
import { createWatchStore } from './store.ts'
import { WatchBody } from './WatchBody.tsx'
import { WatchTitle } from './WatchTitle.tsx'

export type { RedteamConsoleKey } from './locales.ts'
export type { FeedStatus, ListState, WatchState, WatchTabState } from './store.ts'
export type { WatchInjected } from './face.ts'
export type { WatchBodyProps } from './WatchBody.tsx'
export type { EngagementsInjected } from './panel-face.ts'
export type { EngagementsPageProps } from './EngagementsPage.tsx'
export type {
  Compliance, Coverage, Finding, JobRecord, ProofBundle, ReverifyPlan,
} from './engagements-model.ts'
export type { EngagementsState, ReverifyState, SectionState } from './panel-store.ts'

/** This package's copy namespace. */
const NS = 'redteamConsole'

/** The Engagements main panel's id: the sidebar entry and the panel share it. */
export const PANEL_ID = 'engagements' as MainPanelId

/**
 * Required browser services: the slot registry, copy, the layout (the
 * `main` seat's owner), the sidebar (the panel list's owner), and the
 * right Sidebar's tab registry.
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

  // The Engagements main panel: one controller owns its store and data;
  // the sidebar entry and the panel share the panel id.
  const controller = createEngagementsController(createConsoleApi())
  ctx.effect(() => () => { controller.dispose() }, 'ui-redteam-console: engagements controller')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: PANEL_ID, locale: NS, inject: () => controller.face },
    EngagementsPage,
  )), 'ui-redteam-console: engagements panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => t('panel.title'), locale: NS },
    PanelIcon,
  )), 'ui-redteam-console: engagements panel entry')
}
