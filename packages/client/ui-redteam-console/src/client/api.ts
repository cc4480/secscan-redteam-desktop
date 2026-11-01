/**
 * The Watch tab's asynchronous half: reads and control posts against the
 * host console-share routes, plus the live feed connection.
 *
 * Every call addresses the share routes by their document-relative form
 * (`redteam-console/...`): the browser never learns the console's own
 * address or token — the Host attaches the bearer inside its proxy. A call
 * does not reject; the result carries the failure, so the face can write
 * one store state per outcome.
 */
import { CONSOLE_SHARE_PREFIX_ROUTE } from '@secscan/redteam-console-share/shared'
import type {
  AbortOutcome, ConsoleEngagementsResponse, EngagementEvent, EscalateInput, EscalateOutcome,
  FeedState, ModelsResponse,
} from './model.ts'

/** A settled console call: the value, or the failure message to show. */
export type ConsoleResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

/** The console calls the Watch face performs. */
export interface ConsoleApi {
  /**
   * Read the A4 engagement list.
   * @param signal - the owning tab record's lifetime.
   * @returns the list response, or the failure.
   */
  listEngagements(signal: AbortSignal): Promise<ConsoleResult<ConsoleEngagementsResponse>>
  /**
   * Read the fleet's model seats.
   * @param signal - the owning tab record's lifetime.
   * @returns the models response, or the failure.
   */
  models(signal: AbortSignal): Promise<ConsoleResult<ModelsResponse>>
  /**
   * Abort one engagement with an audit-logged reason.
   * @param id - the engagement id.
   * @param reason - the operator's reason, recorded by the console.
   * @returns the console's outcome, or the failure.
   */
  abort(id: string, reason: string): Promise<ConsoleResult<AbortOutcome>>
  /**
   * Change one engagement's autonomy tier under a named operator.
   * @param id - the engagement id.
   * @param input - tier, operator, and reason; Tier 2 carries the explicit
   * production confirmation, exactly as the console's own page sends it.
   * @returns the console's outcome, or the failure.
   */
  escalate(id: string, input: EscalateInput): Promise<ConsoleResult<EscalateOutcome>>
  /**
   * Open the engagement's live event feed.
   * @param id - the engagement id.
   * @param after - resume from this event seq (the server replays nothing at or below it).
   * @param handlers - the feed callbacks.
   * @returns the open connection; close it to stop the stream.
   */
  openFeed(id: string, after: number, handlers: FeedHandlers): FeedConnection
}

/** Callbacks for one open feed connection. */
export interface FeedHandlers {
  /** One engagement event, in seq order. */
  onEvent(event: EngagementEvent): void
  /** One full-state push (the console sends these on its poll cadence). */
  onState(state: FeedState): void
  /** The engagement reached a terminal status and the stream is closing. */
  onDone(status: string): void
  /** The stream errored; the face decides whether to reconnect. */
  onError(): void
}

/** One open feed connection. */
export interface FeedConnection {
  /** Close the stream; no handler fires afterwards. */
  close(): void
}

async function readJson<T>(response: Response): Promise<ConsoleResult<T>> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json() as { error?: unknown; message?: unknown }
      if (typeof body.message === 'string') message = body.message
      else if (typeof body.error === 'string') message = body.error
    } catch {
      // Swallows the parse error: a non-JSON error body keeps the status line as its message.
    }
    return { ok: false, message }
  }
  return { ok: true, value: await response.json() as T }
}

async function settle<T>(call: Promise<ConsoleResult<T>>): Promise<ConsoleResult<T>> {
  try {
    return await call
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The production console API, bound to the share routes.
 * @returns the API the Watch face performs its calls through.
 */
export function createConsoleApi(): ConsoleApi {
  const base = CONSOLE_SHARE_PREFIX_ROUTE
  return {
    listEngagements(signal) {
      return settle(fetch(`${base}/api/console/engagements`, { signal }).then(r => readJson<ConsoleEngagementsResponse>(r)))
    },
    models(signal) {
      return settle(fetch(`${base}/api/models`, { signal }).then(r => readJson<ModelsResponse>(r)))
    },
    abort(id, reason) {
      return settle(fetch(`${base}/api/engagements/${encodeURIComponent(id)}/abort`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      }).then(r => readJson<AbortOutcome>(r)))
    },
    escalate(id, input) {
      return settle(fetch(`${base}/api/engagements/${encodeURIComponent(id)}/escalate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tier: input.tier,
          operator: input.operator,
          reason: input.reason,
          // The console's own page counts choosing Tier 2 in its confirm
          // dialog as the explicit Tier-2 production approval; the same
          // confirm happens here before this call is made.
          confirmTier2Production: input.tier === '2',
        }),
      }).then(r => readJson<EscalateOutcome>(r)))
    },
    openFeed(id, after, handlers) {
      const source = new EventSource(`${base}/api/engagements/${encodeURIComponent(id)}/events?after=${after}`)
      let closed = false
      const parse = <T>(data: string): T | undefined => {
        try {
          return JSON.parse(data) as T
        } catch {
          // Swallows the parse error: a malformed frame is dropped, the stream lives on.
          return undefined
        }
      }
      source.addEventListener('event', (message) => {
        if (closed) return
        const event = parse<EngagementEvent>(message.data)
        if (event !== undefined) handlers.onEvent(event)
      })
      source.addEventListener('state', (message) => {
        if (closed) return
        const state = parse<FeedState>(message.data)
        if (state !== undefined) handlers.onState(state)
      })
      source.addEventListener('done', (message) => {
        if (closed) return
        const done = parse<{ status: string }>(message.data)
        handlers.onDone(done?.status ?? 'complete')
        source.close()
      })
      source.onerror = () => {
        if (!closed) handlers.onError()
      }
      return {
        close() {
          closed = true
          source.close()
        },
      }
    },
  }
}
