/**
 * The Watch tab's view state: the console's engagement list, the fleet's
 * seats, and the selected engagement's live feed.
 *
 * One bucket per tab, in a Slot-standard exclusive store (one instance per
 * session): two Watch tabs in one session select and follow different
 * engagements independently. The feed is a capped window — the newest
 * {@link FEED_CAP} events; the console's events.jsonl stays the complete
 * record. Writers run between `start` and `forget`: the face only
 * dispatches while the tab record's signal is live, and `forget` runs on
 * its abort.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { ConsoleEngagement, ConsoleEngagementsResponse, EngagementEvent, FeedState, ModelSeat } from './model.ts'

/** The newest feed events one tab retains; older events scroll out of the window. */
export const FEED_CAP = 200

/** What the engagement list read is doing right now. */
export type ListState =
  | { readonly kind: 'loading' }
  | {
    readonly kind: 'ready'
    readonly available: boolean
    readonly reason?: string
    readonly engagements: readonly ConsoleEngagement[]
  }
  | { readonly kind: 'failed'; readonly message: string }

/** The feed connection's state for the selected engagement. */
export type FeedStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'failed'

/** One tab's watch: list, seats, selection, and the selected engagement's feed. */
export interface WatchTabState {
  list: ListState
  seats: readonly ModelSeat[] | undefined
  selectedId: string | undefined
  feed: readonly EngagementEvent[]
  feedStatus: FeedStatus
  /** The latest full-state push for the selected engagement. */
  live: FeedState | undefined
  /** The last control outcome's text, in the console's own words, when it sent one. */
  controlNote: string | undefined
  /** Whether the last control call succeeded (its text may still be absent). */
  controlOk: boolean
  controlError: string | undefined
}

/** Every tab's watch, keyed by tab id. */
export interface WatchState {
  byTab: Record<TabId, WatchTabState>
}

/**
 * One tab's bucket, which every writer after `start` relies on.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @returns the tab's watch state.
 */
function bucket(state: WatchState, tabId: TabId): WatchTabState {
  const watch = state.byTab[tabId]
  if (watch === undefined) throw new Error(`ui-redteam-console: no watch state for tab "${tabId}"`)
  return watch
}

/** The watch store's write set; every action names the tab it writes. */
type WatchActions = {
  start: (draft: WatchState, tabId: TabId) => void
  listLoaded: (draft: WatchState, tabId: TabId, response: ConsoleEngagementsResponse) => void
  listFailed: (draft: WatchState, tabId: TabId, message: string) => void
  seatsLoaded: (draft: WatchState, tabId: TabId, seats: readonly ModelSeat[]) => void
  select: (draft: WatchState, tabId: TabId, id: string | undefined) => void
  feedReset: (draft: WatchState, tabId: TabId) => void
  feedAppend: (draft: WatchState, tabId: TabId, event: EngagementEvent) => void
  feedState: (draft: WatchState, tabId: TabId, live: FeedState) => void
  feedStatus: (draft: WatchState, tabId: TabId, status: FeedStatus) => void
  controlSettled: (draft: WatchState, tabId: TabId, note: string | undefined) => void
  controlFailed: (draft: WatchState, tabId: TabId, message: string) => void
  forget: (draft: WatchState, tabId: TabId) => void
}

/**
 * Declare the watch store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createWatchStore(): EngineStoreHandle<WatchState, WatchActions> {
  return defineStore({
    init: (): WatchState => ({ byTab: {} }),
    actions: {
      start: (d, tabId) => {
        d.byTab[tabId] = {
          list: { kind: 'loading' },
          seats: undefined,
          selectedId: undefined,
          feed: [],
          feedStatus: 'idle',
          live: undefined,
          controlNote: undefined,
          controlOk: false,
          controlError: undefined,
        }
      },
      listLoaded: (d, tabId, response) => {
        const watch = bucket(d, tabId)
        watch.list = {
          kind: 'ready',
          available: response.available,
          ...(response.reason === undefined ? {} : { reason: response.reason }),
          engagements: response.engagements,
        }
      },
      listFailed: (d, tabId, message) => {
        bucket(d, tabId).list = { kind: 'failed', message }
      },
      seatsLoaded: (d, tabId, seats) => {
        bucket(d, tabId).seats = seats
      },
      select: (d, tabId, id) => {
        bucket(d, tabId).selectedId = id
      },
      feedReset: (d, tabId) => {
        const watch = bucket(d, tabId)
        watch.feed = []
        watch.live = undefined
      },
      feedAppend: (d, tabId, event) => {
        const watch = bucket(d, tabId)
        const last = watch.feed[watch.feed.length - 1]
        // A reconnect can replay the boundary event; seq order is the truth.
        if (last !== undefined && event.seq <= last.seq) return
        watch.feed = watch.feed.length >= FEED_CAP
          ? [...watch.feed.slice(watch.feed.length - FEED_CAP + 1), event]
          : [...watch.feed, event]
      },
      feedState: (d, tabId, live) => {
        bucket(d, tabId).live = live
      },
      feedStatus: (d, tabId, status) => {
        bucket(d, tabId).feedStatus = status
      },
      controlSettled: (d, tabId, note) => {
        const watch = bucket(d, tabId)
        watch.controlNote = note
        watch.controlOk = true
        watch.controlError = undefined
      },
      controlFailed: (d, tabId, message) => {
        const watch = bucket(d, tabId)
        watch.controlError = message
        watch.controlOk = false
      },
      forget: (d, tabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}
