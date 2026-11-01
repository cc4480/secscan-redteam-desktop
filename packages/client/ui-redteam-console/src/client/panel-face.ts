/**
 * The Engagements panel's controller: owns the panel store and every
 * behavior behind the page's face — load the list, follow a selection with
 * its record sections, fetch proof on demand, and run reverifies (plan
 * first — no traffic — then execute as a background job whose verdict
 * lands back on the finding).
 *
 * Lifecycle follows the panel: the page starts the face when it mounts and
 * stops it when it unmounts, so the panel polls only while it is the
 * visible main panel — a 15 s list refresh while open (the Watch tab is
 * the live surface; this is the record), paused whole while the window is
 * hidden, and a 2 s job poll only while a reverify job is running.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConsoleApi } from './api.ts'
import type { ReverifyJobResult } from './engagements-model.ts'
import { createEngagementsStore } from './panel-store.ts'
import type { EngagementsState } from './panel-store.ts'

/** List refresh cadence while the panel is open. */
const LIST_MS = 15_000
/** Job poll cadence while a reverify executes. */
const JOB_MS = 2_000

/** The face the Engagements page is injected with. */
export interface EngagementsInjected {
  /** The panel's snapshot store, bound by the renderer as `useEngagements`. */
  readonly hooks: { readonly engagements: SnapshotStore<EngagementsState> }
  /** The page mounted: load the list and the selection's sections. */
  start(): void
  /** The page unmounted: stop every timer and in-flight section read. */
  stop(): void
  /** Reload the list and the selection's sections now. */
  refresh(): void
  /**
   * Follow another engagement.
   * @param id - the engagement id.
   */
  select(id: string): void
  /**
   * Fetch one finding's proof bundle (once).
   * @param findingId - the finding id.
   */
  loadProof(findingId: string): void
  /**
   * Ask the console for a reverify plan (no traffic is sent).
   * @param findingId - the finding id.
   */
  planReverify(findingId: string): void
  /**
   * Execute the reverify as a background job against the given scope hosts.
   * @param findingId - the finding id.
   * @param scope - exact hosts, enforced mechanically by the console.
   */
  executeReverify(findingId: string, scope: readonly string[]): void
}

/** The controller: the face to inject, and its disposal. */
export interface EngagementsController {
  readonly face: EngagementsInjected
  /** Stop every timer and in-flight read; the panel is going away. */
  dispose(): void
}

/**
 * Build the Engagements controller over a console API.
 * @param api - the console calls.
 * @returns the controller.
 */
export function createEngagementsController(api: ConsoleApi): EngagementsController {
  const instance = createEngagementsStore().create()
  const actions = instance.actions
  let started = false
  let listTimer: ReturnType<typeof setInterval> | undefined
  let jobTimer: ReturnType<typeof setInterval> | undefined
  let sections: AbortController | undefined
  let listInFlight = false
  const executing = new Map<string, string>()

  const selectedId = (): string | undefined => instance.getSnapshot().selectedId

  const loadSections = (id: string): void => {
    sections?.abort()
    const controller = new AbortController()
    sections = controller
    const { signal } = controller
    actions.sectionLoading('findings')
    actions.sectionLoading('coverage')
    actions.sectionLoading('compliance')
    void api.findings(id, signal).then((result) => {
      if (signal.aborted || selectedId() !== id) return
      if (result.ok) actions.findingsLoaded(result.value)
      else actions.sectionFailed('findings', result.message)
    })
    void api.coverage(id, signal).then((result) => {
      if (signal.aborted || selectedId() !== id) return
      if (result.ok) actions.coverageLoaded(result.value)
      else actions.sectionFailed('coverage', result.message)
    })
    void api.compliance(id, signal).then((result) => {
      if (signal.aborted || selectedId() !== id) return
      if (result.ok) actions.complianceLoaded(result.value)
      else actions.sectionFailed('compliance', result.message)
    })
  }

  const applySelection = (id: string | undefined): void => {
    if (id === selectedId()) return
    actions.select(id)
    if (id !== undefined) loadSections(id)
  }

  const cycle = async (): Promise<void> => {
    if (!started || listInFlight) return
    if (typeof document !== 'undefined' && document.hidden) return
    listInFlight = true
    try {
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
      const keep = engagements.find(entry => entry.id === selectedId())
      const next = keep ?? engagements.find(entry => entry.live) ?? engagements[0]
      applySelection(next?.id)
    } finally {
      listInFlight = false
    }
  }

  const pollJobs = async (): Promise<void> => {
    for (const [findingId, jobId] of [...executing]) {
      const result = await api.job(jobId, new AbortController().signal)
      if (!started) return
      if (!result.ok) {
        executing.delete(findingId)
        actions.reverifySet(findingId, { kind: 'failed', message: result.message })
        continue
      }
      const job = result.value
      if (job.status === 'running') continue
      executing.delete(findingId)
      if (job.status === 'failed') {
        actions.reverifySet(findingId, { kind: 'failed', message: job.error ?? 'reverify job failed' })
      } else {
        const payload = (job.result ?? {}) as ReverifyJobResult
        actions.reverifySet(findingId, {
          kind: 'done',
          verdict: typeof payload.verdict === 'string' ? payload.verdict : undefined,
          summary: typeof payload.summary === 'string' ? payload.summary : undefined,
        })
      }
    }
    if (executing.size === 0 && jobTimer !== undefined) {
      clearInterval(jobTimer)
      jobTimer = undefined
    }
  }

  const ensureJobPoller = (): void => {
    if (jobTimer !== undefined) return
    jobTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void pollJobs()
    }, JOB_MS)
  }

  const trackJob = (findingId: string, jobId: string): void => {
    executing.set(findingId, jobId)
    actions.reverifySet(findingId, { kind: 'executing', jobId })
    ensureJobPoller()
    // A fast job resolves on the first poll, not a cadence later.
    void pollJobs()
  }

  const stop = (): void => {
    started = false
    if (listTimer !== undefined) clearInterval(listTimer)
    if (jobTimer !== undefined) clearInterval(jobTimer)
    listTimer = undefined
    jobTimer = undefined
    sections?.abort()
  }

  const face: EngagementsInjected = {
    hooks: { engagements: instance.store },
    start() {
      if (started) return
      started = true
      void cycle()
      listTimer = setInterval(() => { void cycle() }, LIST_MS)
    },
    stop,
    refresh() {
      void cycle()
      const id = selectedId()
      if (id !== undefined) loadSections(id)
    },
    select(id) {
      applySelection(id)
    },
    loadProof(findingId) {
      const id = selectedId()
      if (id === undefined) return
      actions.proofLoading(findingId)
      void api.proof(id, findingId, new AbortController().signal).then((result) => {
        if (selectedId() !== id) return
        if (result.ok) actions.proofLoaded(findingId, result.value)
        else actions.proofFailed(findingId, result.message)
      })
    },
    planReverify(findingId) {
      const id = selectedId()
      if (id === undefined) return
      actions.reverifySet(findingId, { kind: 'planning' })
      void api.reverify({ id, finding: findingId }).then((result) => {
        if (selectedId() !== id) return
        if (!result.ok) {
          actions.reverifySet(findingId, { kind: 'failed', message: result.message })
        } else if ('plan' in result.value) {
          actions.reverifySet(findingId, { kind: 'plan', plan: result.value })
        } else {
          trackJob(findingId, result.value.jobId)
        }
      })
    },
    executeReverify(findingId, scope) {
      const id = selectedId()
      if (id === undefined) return
      void api.reverify({ id, finding: findingId, execute: true, scope }).then((result) => {
        if (selectedId() !== id) return
        if (!result.ok) {
          actions.reverifySet(findingId, { kind: 'failed', message: result.message })
        } else if ('jobId' in result.value) {
          trackJob(findingId, result.value.jobId)
        } else {
          actions.reverifySet(findingId, { kind: 'plan', plan: result.value })
        }
      })
    },
  }
  return { face, dispose: stop }
}
