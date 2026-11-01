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
import { ArsenalPage } from './ArsenalPage.tsx'
import { createArsenalController, createReportsController } from './arsenal-face.ts'
import { WATCH_ID, watchDefinition } from './definition.ts'
import { EngagementsPage } from './EngagementsPage.tsx'
import { watchFace } from './face.ts'
import { FoundryPage } from './FoundryPage.tsx'
import { createFoundryController, createScopeController } from './foundry-face.ts'
import { en, zh } from './locales.ts'
import { PanelIcon } from './PanelIcon.tsx'
import { ArsenalIcon, FoundryIcon, ReportsIcon, ScopeIcon } from './PanelIcons.tsx'
import { createEngagementsController } from './panel-face.ts'
import { ReportsPage } from './ReportsPage.tsx'
import { ScopePage } from './ScopePage.tsx'
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
export type { ArsenalInjected, ReportsInjected } from './arsenal-face.ts'
export type { FoundryInjected, ScopeInjected } from './foundry-face.ts'
export type { ArsenalPageProps } from './ArsenalPage.tsx'
export type { FoundryPageProps } from './FoundryPage.tsx'
export type { ReportsPageProps } from './ReportsPage.tsx'
export type { ScopePageProps } from './ScopePage.tsx'
export type {
  ArsenalBrowse, ArsenalItem, ArsenalResults, EngagementDetail, FoundryState,
  ScopeAggregate,
} from './library-model.ts'

/** This package's copy namespace. */
const NS = 'redteamConsole'

/** The Engagements main panel's id: the sidebar entry and the panel share it. */
export const PANEL_ID = 'engagements' as MainPanelId

/** The Foundry main panel's id. */
export const FOUNDRY_PANEL_ID = 'foundry' as MainPanelId

/** The Arsenal main panel's id. */
export const ARSENAL_PANEL_ID = 'arsenal' as MainPanelId

/** The Reports library's main panel id. */
export const REPORTS_PANEL_ID = 'reports' as MainPanelId

/** The Scope & Safety main panel's id. */
export const SCOPE_PANEL_ID = 'scope-safety' as MainPanelId

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
  const inject = watchFace(createConsoleApi(status => t('api.httpStatus', { status })))
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
  const controller = createEngagementsController(createConsoleApi(status => t('api.httpStatus', { status })))
  ctx.effect(() => () => { controller.dispose() }, 'ui-redteam-console: engagements controller')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: PANEL_ID, locale: NS, inject: () => controller.face },
    EngagementsPage,
  )), 'ui-redteam-console: engagements panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => t('panel.title'), locale: NS },
    PanelIcon,
  )), 'ui-redteam-console: engagements panel entry')

  // Phase 3 rail destinations: Foundry, Arsenal, Reports, Scope & Safety —
  // each a controller-owned main panel with its own sidebar entry.
  const foundry = createFoundryController(createConsoleApi(status => t('api.httpStatus', { status })))
  ctx.effect(() => () => { foundry.dispose() }, 'ui-redteam-console: foundry controller')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: FOUNDRY_PANEL_ID, locale: NS, inject: () => foundry.face },
    FoundryPage,
  )), 'ui-redteam-console: foundry panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: FOUNDRY_PANEL_ID, order: 20, label: () => t('foundry.title'), locale: NS },
    FoundryIcon,
  )), 'ui-redteam-console: foundry panel entry')

  const arsenal = createArsenalController(createConsoleApi(status => t('api.httpStatus', { status })))
  ctx.effect(() => () => { arsenal.dispose() }, 'ui-redteam-console: arsenal controller')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: ARSENAL_PANEL_ID, locale: NS, inject: () => arsenal.face },
    ArsenalPage,
  )), 'ui-redteam-console: arsenal panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: ARSENAL_PANEL_ID, order: 30, label: () => t('arsenal.title'), locale: NS },
    ArsenalIcon,
  )), 'ui-redteam-console: arsenal panel entry')

  const reports = createReportsController(createConsoleApi(status => t('api.httpStatus', { status })))
  ctx.effect(() => () => { reports.dispose() }, 'ui-redteam-console: reports controller')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: REPORTS_PANEL_ID, locale: NS, inject: () => reports.face },
    ReportsPage,
  )), 'ui-redteam-console: reports panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: REPORTS_PANEL_ID, order: 40, label: () => t('reports.title'), locale: NS },
    ReportsIcon,
  )), 'ui-redteam-console: reports panel entry')

  const scopePanel = createScopeController(createConsoleApi(status => t('api.httpStatus', { status })))
  ctx.effect(() => () => { scopePanel.dispose() }, 'ui-redteam-console: scope controller')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: SCOPE_PANEL_ID, locale: NS, inject: () => scopePanel.face },
    ScopePage,
  )), 'ui-redteam-console: scope panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: SCOPE_PANEL_ID, order: 50, label: () => t('scope.title'), locale: NS },
    ScopeIcon,
  )), 'ui-redteam-console: scope panel entry')
}
