/**
 * The Watch tab's face: polls the console's engagement list, follows the
 * selected engagement's live feed, and performs the control posts.
 *
 * Performance is part of this face's contract (Carlos's guardrail,
 * 2026-11-01): the list polls on a {@link POLL_MS} cadence and PAUSES
 * while the window is hidden — a hidden tab fetches nothing and wakes to
 * an immediate refresh when the window returns. The feed writes are
 * append-only store actions, one per event, so a busy engagement appends
 * rows instead of re-rendering the list; the roster's seats refresh on a
 * slow multiple of the poll cadence because they change only when the
 * operator reseats a model. Nothing here touches the chat's own traffic:
 * every call goes to the console-share routes, never through the session
 * or model paths.
 *
 * One runtime per tab: a poll timer, at most one feed connection, and the
 * generations that keep a slow answer from overwriting a newer one. The
 * tab record's `signal` ends the runtime — timer, connection, pending
 * reconnect, and in-flight fetches all die with it, and the store bucket
 * is forgotten.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConsoleApi, FeedConnection } from './api.ts'
import type { ConsoleEngagement, EscalateInput } from './model.ts'
import type { createWatchStore } from './store.ts'

/** Engagement-list poll cadence while the tab is open and the window visible. */
export const POLL_MS = 4_000

/** Seats refresh on every Nth list poll (they change only on a reseat). */
export const SEATS_EVERY_POLLS = 8

/** Delay before the feed reconnects after a stream error. */
export const RECONNECT_MS = 5_000

/** The Watch body's injected business face. */
export interface WatchInjected {
  /**
   * Seed this tab's watch and start its poll + feed runtime.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  start(tabId: TabId, signal: AbortSignal): void
  /**
   * Reload the list (and seats) now.
   * @param tabId - the tab asking.
   */
  refresh(tabId: TabId): void
  /**
   * Follow a different engagement: selection, feed reset, fresh stream.
   * @param tabId - the tab asking.
   * @param id - the engagement to follow.
   */
  select(tabId: TabId, id: string): void
  /**
   * Abort one engagement with an audit-logged reason.
   * @param tabId - the tab asking.
   * @param id - the engagement id.
   * @param reason - the operator's reason.
   */
  abort(tabId: TabId, id: string, reason: string): void
  /**
   * Change one engagement's autonomy tier under a named operator.
   * @param tabId - the tab asking.
   * @param id - the engagement id.
   * @param input - tier, operator, and reason.
   */
  escalate(tabId: TabId, id: string, input: EscalateInput): void
}

/** Per-tab runtime the face keeps outside the store. */
interface TabRuntime {
  /** The tab record's lifetime; every fetch carries it. */
  signal: AbortSignal
  /** List-load generation; a settlement writes only while it is the latest. */
  generation: number
  /** Feed generation; handlers of a replaced connection write nothing. */
  feedGeneration: number
  /** Completed poll cycles, driving the seats cadence. */
  ticks: number
  /** The engagement the feed follows (mirrors the store's selection). */
  selectedId: string | undefined
  /** Whether the followed engagement was live at the last list read. */
  selectedLive: boolean
  /** Seq of the newest feed event applied; the reconnect resume point. */
  lastSeq: number
  timer: ReturnType<typeof setTimeout> | undefined
  reconnect: ReturnType<typeof setTimeout> | undefined
  connection: FeedConnection | undefined
}

/**
 * Bind the watch face to one console API.
 * @param api - the bound console calls.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function watchFace(
  api: ConsoleApi,
): (_sessionId: SessionId, actions: BoundActions<ReturnType<typeof createWatchStore>>) => WatchInjected {
  return (_sessionId, actions) => {
    const runtimes = new Map<TabId, TabRuntime>()

    const clearTimer = (runtime: TabRuntime): void => {
      if (runtime.timer !== undefined) clearTimeout(runtime.timer)
      runtime.timer = undefined
    }
    const clearReconnect = (runtime: TabRuntime): void => {
      if (runtime.reconnect !== undefined) clearTimeout(runtime.reconnect)
      runtime.reconnect = undefined
    }
    const closeFeed = (runtime: TabRuntime): void => {
      runtime.feedGeneration++
      runtime.connection?.close()
      runtime.connection = undefined
      clearReconnect(runtime)
    }

    /**
     * Open (or resume) the feed for one engagement. A resume keeps the
     * store's events and continues from the last applied seq; a fresh open
     * resets them. Either way the previous connection's handlers are
     * generation-dead before the new one is created.
     */
    const connect = (tabId: TabId, runtime: TabRuntime, id: string, fresh: boolean): void => {
      closeFeed(runtime)
      if (fresh) {
        runtime.lastSeq = 0
        actions.feedReset(tabId)
      }
      actions.feedStatus(tabId, 'connecting')
      const generation = runtime.feedGeneration
      runtime.connection = api.openFeed(id, runtime.lastSeq, {
        onEvent: (event) => {
          if (runtime.feedGeneration !== generation) return
          runtime.lastSeq = event.seq
          actions.feedAppend(tabId, event)
          actions.feedStatus(tabId, 'live')
        },
        onState: (state) => {
          if (runtime.feedGeneration !== generation) return
          actions.feedState(tabId, state)
          // A state push is stream traffic too: the feed is live even when
          // no events are flowing (the console pushes state on its own
          // cadence precisely so a quiet run still reads as connected).
          actions.feedStatus(tabId, 'live')
        },
        onDone: () => {
          if (runtime.feedGeneration !== generation) return
          actions.feedStatus(tabId, 'ended')
          runtime.connection?.close()
          runtime.connection = undefined
          // The terminal list state (status, findings, report) lands now.
          void cycle(tabId, runtime)
        },
        onError: () => {
          if (runtime.feedGeneration !== generation) return
          actions.feedStatus(tabId, 'failed')
          runtime.connection?.close()
          runtime.connection = undefined
          if (!fresh) return
          // A fresh stream that breaks reconnects once, resuming from the
          // last applied seq, while the followed engagement is still live;
          // a resumed stream that breaks stays down until the next
          // selection — the poll keeps the list honest meanwhile.
          clearReconnect(runtime)
          runtime.reconnect = setTimeout(() => {
            runtime.reconnect = undefined
            if (runtime.feedGeneration !== generation || !runtime.selectedLive) return
            connect(tabId, runtime, id, false)
          }, RECONNECT_MS)
        },
      })
    }

    /** Keep the selection inside the list: the live engagement wins, then the newest row. */
    const resolveSelection = (tabId: TabId, runtime: TabRuntime, engagements: readonly ConsoleEngagement[]): void => {
      const current = runtime.selectedId === undefined
        ? undefined
        : engagements.find(entry => entry.id === runtime.selectedId)
      const next = current ?? engagements.find(entry => entry.live) ?? engagements[0]
      runtime.selectedLive = next?.live ?? false
      if (next === undefined) {
        if (runtime.selectedId !== undefined) {
          runtime.selectedId = undefined
          actions.select(tabId, undefined)
          closeFeed(runtime)
          actions.feedStatus(tabId, 'idle')
        }
        return
      }
      if (next.id !== runtime.selectedId) {
        runtime.selectedId = next.id
        actions.select(tabId, next.id)
        connect(tabId, runtime, next.id, true)
      }
    }

    const cycle = async (tabId: TabId, runtime: TabRuntime): Promise<void> => {
      const generation = ++runtime.generation
      runtime.ticks++
      const listCall = api.listEngagements(runtime.signal)
      const seatsCall = runtime.ticks === 1 || runtime.ticks % SEATS_EVERY_POLLS === 0
        ? api.models(runtime.signal)
        : undefined
      const [list, seats] = await Promise.all([listCall, seatsCall ?? Promise.resolve(undefined)])
      if (runtime.generation !== generation || runtime.signal.aborted) return
      if (seats !== undefined && seats.ok) actions.seatsLoaded(tabId, seats.value.seats)
      if (!list.ok) {
        actions.listFailed(tabId, list.message)
        return
      }
      actions.listLoaded(tabId, list.value)
      if (list.value.available) resolveSelection(tabId, runtime, list.value.engagements)
    }

    const schedule = (tabId: TabId, runtime: TabRuntime): void => {
      clearTimer(runtime)
      runtime.timer = setTimeout(() => {
        runtime.timer = undefined
        // The guardrail's pause: a hidden window fetches nothing; the
        // visibility listener below refreshes the moment it returns.
        if (typeof document === 'undefined' || !document.hidden) void cycle(tabId, runtime)
        schedule(tabId, runtime)
      }, POLL_MS)
    }

    return {
      start(tabId, signal) {
        if (runtimes.has(tabId)) return
        const runtime: TabRuntime = {
          signal,
          generation: 0,
          feedGeneration: 0,
          ticks: 0,
          selectedId: undefined,
          selectedLive: false,
          lastSeq: 0,
          timer: undefined,
          reconnect: undefined,
          connection: undefined,
        }
        runtimes.set(tabId, runtime)
        actions.start(tabId)
        const onVisibility = (): void => {
          if (!document.hidden) void cycle(tabId, runtime)
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
        signal.addEventListener('abort', () => {
          runtimes.delete(tabId)
          clearTimer(runtime)
          closeFeed(runtime)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
          actions.forget(tabId)
        }, { once: true })
        void cycle(tabId, runtime)
        schedule(tabId, runtime)
      },
      refresh(tabId) {
        const runtime = runtimes.get(tabId)
        if (runtime !== undefined) void cycle(tabId, runtime)
      },
      select(tabId, id) {
        const runtime = runtimes.get(tabId)
        if (runtime === undefined || runtime.selectedId === id) return
        runtime.selectedId = id
        runtime.selectedLive = false
        actions.select(tabId, id)
        connect(tabId, runtime, id, true)
      },
      abort(tabId, id, reason) {
        const runtime = runtimes.get(tabId)
        if (runtime === undefined) return
        void api.abort(id, reason).then((result) => {
          if (!runtimes.has(tabId)) return
          if (result.ok) actions.controlSettled(tabId, result.value.note)
          else actions.controlFailed(tabId, result.message)
          void cycle(tabId, runtime)
        })
      },
      escalate(tabId, id, input) {
        const runtime = runtimes.get(tabId)
        if (runtime === undefined) return
        void api.escalate(id, input).then((result) => {
          if (!runtimes.has(tabId)) return
          if (result.ok) actions.controlSettled(tabId, result.value.message)
          else actions.controlFailed(tabId, result.message)
          void cycle(tabId, runtime)
        })
      },
    }
  }
}
