/**
 * Snapshot stores for the Phase 3 panels (Foundry, Arsenal, Reports,
 * Scope & Safety). Each panel's controller owns one store instance; the
 * page reads it through the face's hook. No subscriptions live in the
 * components, and no store polls on its own — the controllers own every
 * timer, and there are none here beyond explicit loads and actions.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type {
  ArsenalBrowse, ArsenalResults, EngagementDetail, FoundryActionKind,
  FoundryActionResult, FoundryState, ScopeAggregate,
} from './library-model.ts'
import type { SectionState } from './panel-store.ts'
import type { ListState } from './store.ts'

/* ------------------------------------------------------------------ */
/* Foundry                                                             */
/* ------------------------------------------------------------------ */

/** One Foundry action's run state. */
export type FoundryActionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly action: FoundryActionKind }
  | { readonly kind: 'done'; readonly action: FoundryActionKind; readonly result: FoundryActionResult }
  | { readonly kind: 'failed'; readonly action: FoundryActionKind; readonly message: string }

/** The Foundry panel's state. */
export interface FoundryPanelState {
  section: SectionState<FoundryState>
  action: FoundryActionState
}

/** Store factory for the Foundry panel. */
export function createFoundryStore() {
  return defineStore<FoundryPanelState, {
    loading: (draft: FoundryPanelState) => void
    loaded: (draft: FoundryPanelState, value: FoundryState) => void
    failed: (draft: FoundryPanelState, message: string) => void
    actionRunning: (draft: FoundryPanelState, action: FoundryActionKind) => void
    actionDone: (draft: FoundryPanelState, action: FoundryActionKind, result: FoundryActionResult) => void
    actionFailed: (draft: FoundryPanelState, action: FoundryActionKind, message: string) => void
  }>({
    init: (): FoundryPanelState => ({ section: { kind: 'loading' }, action: { kind: 'idle' } }),
    actions: {
      loading: (d) => { d.section = { kind: 'loading' } },
      loaded: (d, value) => { d.section = { kind: 'ready', value } },
      failed: (d, message) => { d.section = { kind: 'failed', message } },
      actionRunning: (d, action) => { d.action = { kind: 'running', action } },
      actionDone: (d, action, result) => { d.action = { kind: 'done', action, result } },
      actionFailed: (d, action, message) => { d.action = { kind: 'failed', action, message } },
    },
  })
}

/* ------------------------------------------------------------------ */
/* Arsenal                                                             */
/* ------------------------------------------------------------------ */

/** The Arsenal panel's state: the browse census/category plus one result set. */
export interface ArsenalPanelState {
  browse: SectionState<ArsenalBrowse>
  /** The drilled category, when browsing one topic's collections. */
  category: string | undefined
  results: SectionState<ArsenalResults> | undefined
  /** What produced the current results (the search text or task). */
  query: string | undefined
}

/** Store factory for the Arsenal panel. */
export function createArsenalStore() {
  return defineStore<ArsenalPanelState, {
    browseLoading: (draft: ArsenalPanelState) => void
    browseLoaded: (draft: ArsenalPanelState, value: ArsenalBrowse, category: string | undefined) => void
    browseFailed: (draft: ArsenalPanelState, message: string) => void
    resultsLoading: (draft: ArsenalPanelState, query: string) => void
    resultsLoaded: (draft: ArsenalPanelState, value: ArsenalResults) => void
    resultsFailed: (draft: ArsenalPanelState, message: string) => void
    clearResults: (draft: ArsenalPanelState) => void
  }>({
    init: (): ArsenalPanelState => ({ browse: { kind: 'loading' }, category: undefined, results: undefined, query: undefined }),
    actions: {
      browseLoading: (d) => { d.browse = { kind: 'loading' } },
      browseLoaded: (d, value, category) => { d.browse = { kind: 'ready', value }; d.category = category },
      browseFailed: (d, message) => { d.browse = { kind: 'failed', message } },
      resultsLoading: (d, query) => { d.results = { kind: 'loading' }; d.query = query },
      resultsLoaded: (d, value) => { d.results = { kind: 'ready', value } },
      resultsFailed: (d, message) => { d.results = { kind: 'failed', message } },
      clearResults: (d) => { d.results = undefined; d.query = undefined },
    },
  })
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

/** The Reports library's state: the engagement list plus one detail. */
export interface ReportsPanelState {
  list: ListState
  selectedId: string | undefined
  detail: SectionState<EngagementDetail> | undefined
}

/** Store factory for the Reports library. */
export function createReportsStore() {
  return defineStore<ReportsPanelState, {
    listLoading: (draft: ReportsPanelState) => void
    listLoaded: (draft: ReportsPanelState, list: ListState) => void
    listFailed: (draft: ReportsPanelState, message: string) => void
    select: (draft: ReportsPanelState, id: string | undefined) => void
    detailLoading: (draft: ReportsPanelState) => void
    detailLoaded: (draft: ReportsPanelState, value: EngagementDetail) => void
    detailFailed: (draft: ReportsPanelState, message: string) => void
  }>({
    init: (): ReportsPanelState => ({ list: { kind: 'loading' }, selectedId: undefined, detail: undefined }),
    actions: {
      listLoading: (d) => { d.list = { kind: 'loading' } },
      listLoaded: (d, list) => { d.list = list },
      listFailed: (d, message) => { d.list = { kind: 'failed', message } },
      select: (d, id) => {
        if (d.selectedId === id) return
        d.selectedId = id
        d.detail = undefined
      },
      detailLoading: (d) => { d.detail = { kind: 'loading' } },
      detailLoaded: (d, value) => { d.detail = { kind: 'ready', value } },
      detailFailed: (d, message) => { d.detail = { kind: 'failed', message } },
    },
  })
}

/* ------------------------------------------------------------------ */
/* Scope & Safety                                                      */
/* ------------------------------------------------------------------ */

/** The Scope & Safety panel's state. */
export interface ScopePanelState {
  section: SectionState<ScopeAggregate>
}

/** Store factory for the Scope & Safety panel. */
export function createScopeStore() {
  return defineStore<ScopePanelState, {
    loading: (draft: ScopePanelState) => void
    loaded: (draft: ScopePanelState, value: ScopeAggregate) => void
    failed: (draft: ScopePanelState, message: string) => void
  }>({
    init: (): ScopePanelState => ({ section: { kind: 'loading' } }),
    actions: {
      loading: (d) => { d.section = { kind: 'loading' } },
      loaded: (d, value) => { d.section = { kind: 'ready', value } },
      failed: (d, message) => { d.section = { kind: 'failed', message } },
    },
  })
}
