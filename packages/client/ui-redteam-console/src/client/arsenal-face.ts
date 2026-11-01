/**
 * The Arsenal and Reports controllers. Neither polls: the Arsenal index
 * answers on demand (browse on mount, search/recommend on submit), and
 * the Reports library loads its list on mount with an explicit refresh —
 * a library of finished engagements is a snapshot, not a live surface.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConsoleApi } from './api.ts'
import type { ArsenalBrowse, ArsenalResults } from './library-model.ts'
import { createArsenalStore, createReportsStore } from './library-store.ts'
import type { ArsenalPanelState, ReportsPanelState } from './library-store.ts'

/* ------------------------------------------------------------------ */
/* Arsenal                                                             */
/* ------------------------------------------------------------------ */

/** The face the Arsenal page is injected with. */
export interface ArsenalInjected {
  /** The panel's snapshot store, bound by the renderer as `useArsenal`. */
  readonly hooks: { readonly arsenal: SnapshotStore<ArsenalPanelState> }
  /** The page mounted: load the browse census. */
  start(): void
  /** The page unmounted: ignore in-flight answers. */
  stop(): void
  /**
   * Browse the census, or one topic's collections.
   * @param category - the topic; omit for the census.
   */
  browse(category?: string): void
  /**
   * Search the index by free text.
   * @param query - the search text.
   */
  search(query: string): void
  /**
   * Ask for task-shaped recommendations.
   * @param task - the current task text.
   */
  recommend(task: string): void
  /** Back to browsing (drop the current results). */
  clearResults(): void
}

/** The controller: the face to inject, and its disposal. */
export interface ArsenalController {
  readonly face: ArsenalInjected
  /** The panel is going away. */
  dispose(): void
}

/**
 * Build the Arsenal controller over a console API.
 * @param api - the console calls.
 * @returns the controller.
 */
export function createArsenalController(api: ConsoleApi): ArsenalController {
  const instance = createArsenalStore().create()
  const actions = instance.actions
  let started = false
  let generation = 0

  const browse = (category?: string): void => {
    const mine = ++generation
    actions.browseLoading()
    void api.arsenal<ArsenalBrowse>('arsenal_browse', category === undefined ? {} : { category }).then((result) => {
      if (!started || mine !== generation) return
      if (result.ok) actions.browseLoaded(result.value, category)
      else actions.browseFailed(result.message)
    })
  }

  const run = (tool: 'arsenal_search' | 'arsenal_recommend', text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '') return
    const mine = ++generation
    actions.resultsLoading(trimmed)
    const args = tool === 'arsenal_search' ? { query: trimmed, limit: 25 } : { task: trimmed, limit: 25 }
    void api.arsenal<ArsenalResults>(tool, args).then((result) => {
      if (!started || mine !== generation) return
      if (result.ok) actions.resultsLoaded(result.value)
      else actions.resultsFailed(result.message)
    })
  }

  const stop = (): void => {
    started = false
    generation++
  }

  const face: ArsenalInjected = {
    hooks: { arsenal: instance.store },
    start() {
      if (started) return
      started = true
      browse()
    },
    stop,
    browse,
    search(query) { run('arsenal_search', query) },
    recommend(task) { run('arsenal_recommend', task) },
    clearResults() { actions.clearResults() },
  }
  return { face, dispose: stop }
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

/** The face the Reports page is injected with. */
export interface ReportsInjected {
  /** The panel's snapshot store, bound by the renderer as `useReports`. */
  readonly hooks: { readonly reports: SnapshotStore<ReportsPanelState> }
  /** The page mounted: load the list. */
  start(): void
  /** The page unmounted: ignore in-flight answers. */
  stop(): void
  /** Reload the list and the selected detail now. */
  refresh(): void
  /**
   * Open another engagement's deliverables.
   * @param id - the engagement id.
   */
  select(id: string): void
}

/** The controller: the face to inject, and its disposal. */
export interface ReportsController {
  readonly face: ReportsInjected
  /** The panel is going away. */
  dispose(): void
}

/**
 * Build the Reports controller over a console API.
 * @param api - the console calls.
 * @returns the controller.
 */
export function createReportsController(api: ConsoleApi): ReportsController {
  const instance = createReportsStore().create()
  const actions = instance.actions
  let started = false
  let generation = 0

  const loadDetail = (id: string): void => {
    const mine = ++generation
    actions.detailLoading()
    void api.detail(id, new AbortController().signal).then((result) => {
      if (!started || mine !== generation) return
      if (instance.getSnapshot().selectedId !== id) return
      if (result.ok) actions.detailLoaded(result.value)
      else actions.detailFailed(result.message)
    })
  }

  const applySelection = (id: string | undefined): void => {
    if (id === instance.getSnapshot().selectedId) return
    actions.select(id)
    if (id !== undefined) loadDetail(id)
  }

  const loadList = async (): Promise<void> => {
    const result = await api.listEngagements(new AbortController().signal)
    if (!started) return
    if (!result.ok) {
      actions.listFailed(result.message)
      return
    }
    actions.listLoaded({
      kind: 'ready',
      available: result.value.available,
      ...(result.value.reason !== undefined ? { reason: result.value.reason } : {}),
      engagements: result.value.engagements,
    })
    const engagements = result.value.engagements
    const keep = engagements.find(entry => entry.id === instance.getSnapshot().selectedId)
    // The library is about finished work: prefer the newest completed
    // engagement, then any row, over a live one.
    const next = keep ?? engagements.find(entry => !entry.live) ?? engagements[0]
    applySelection(next?.id)
  }

  const stop = (): void => {
    started = false
    generation++
  }

  const face: ReportsInjected = {
    hooks: { reports: instance.store },
    start() {
      if (started) return
      started = true
      void loadList()
    },
    stop,
    refresh() {
      void loadList()
      const id = instance.getSnapshot().selectedId
      if (id !== undefined) loadDetail(id)
    },
    select(id) {
      applySelection(id)
    },
  }
  return { face, dispose: stop }
}
