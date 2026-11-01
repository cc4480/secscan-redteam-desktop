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
  ArsenalToolName, EngagementDetail, FoundryActionKind, FoundryActionResult,
  FoundryState, ScopeAggregate,
} from './library-model.ts'
import type {
  Compliance, Coverage, Finding, JobRecord, ProofBundle, ReverifyPlan,
} from './engagements-model.ts'
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
  /**
   * Read one engagement's confirmed findings (each flagged with proof availability).
   * @param id - the engagement id.
   * @param signal - the caller's lifetime.
   * @returns the findings, or the failure.
   */
  findings(id: string, signal: AbortSignal): Promise<ConsoleResult<readonly Finding[]>>
  /**
   * Read one finding's proof bundle.
   * @param id - the engagement id.
   * @param findingId - the finding id (F-1, …).
   * @param signal - the caller's lifetime.
   * @returns the bundle, or the failure.
   */
  proof(id: string, findingId: string, signal: AbortSignal): Promise<ConsoleResult<ProofBundle>>
  /**
   * Read one engagement's coverage rollup.
   * @param id - the engagement id.
   * @param signal - the caller's lifetime.
   * @returns the coverage, or the failure.
   */
  coverage(id: string, signal: AbortSignal): Promise<ConsoleResult<Coverage>>
  /**
   * Read one engagement's compliance documents (server-rendered HTML).
   * @param id - the engagement id.
   * @param signal - the caller's lifetime.
   * @returns the documents, or the failure.
   */
  compliance(id: string, signal: AbortSignal): Promise<ConsoleResult<Compliance>>
  /**
   * Start a reverify for one finding: a plan when `execute` is falsy (no
   * traffic), a background job when executing (scope hosts required by the
   * console, enforced mechanically there).
   * @param input - engagement id, finding id, and the execute/scope choice.
   * @returns the plan or the job handle, or the failure.
   */
  reverify(input: ReverifyInput): Promise<ConsoleResult<ReverifyStart>>
  /**
   * Read one background job's record.
   * @param jobId - the job id.
   * @param signal - the caller's lifetime.
   * @returns the job, or the failure.
   */
  job(jobId: string, signal: AbortSignal): Promise<ConsoleResult<JobRecord>>
  /**
   * Read one engagement's detail record (the Reports library's source:
   * the autofire completion record rides `state.deliverables`).
   * @param id - the engagement id.
   * @param signal - the caller's lifetime.
   * @returns the detail, or the failure.
   */
  detail(id: string, signal: AbortSignal): Promise<ConsoleResult<EngagementDetail>>
  /**
   * Read the Foundry state (snapshot, gate, store, loop).
   * @param signal - the caller's lifetime.
   * @returns the state, or the failure.
   */
  foundry(signal: AbortSignal): Promise<ConsoleResult<FoundryState>>
  /**
   * Fire one Foundry gate action; the answer lands when the run settles
   * (verify is quick; run-gold can take minutes on the console side).
   * @param kind - which action.
   * @returns the action's answer, or the failure.
   */
  foundryAction(kind: FoundryActionKind): Promise<ConsoleResult<FoundryActionResult>>
  /**
   * Call one Arsenal tool through the Phase 0 bridge (the browser never
   * speaks MCP; the bridge forwards only the three read-only tools).
   * @param tool - the tool name.
   * @param args - the tool arguments.
   * @returns the tool's parsed JSON result, or the failure.
   */
  arsenal<T>(tool: ArsenalToolName, args: Readonly<Record<string, unknown>>): Promise<ConsoleResult<T>>
  /**
   * Read the cross-engagement Scope & Safety aggregate.
   * @param signal - the caller's lifetime.
   * @returns the aggregate, or the failure.
   */
  scope(signal: AbortSignal): Promise<ConsoleResult<ScopeAggregate>>
}

/** A reverify request: the console resolves the bundle from the engagement's own records. */
export interface ReverifyInput {
  readonly id: string
  readonly finding: string
  readonly execute?: boolean
  readonly scope?: readonly string[]
}

/** A reverify start: the plan (no traffic sent) or the background job's handle. */
export type ReverifyStart = ReverifyPlan | { readonly jobId: string }

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

async function readJson<T>(response: Response, httpStatus: (status: number) => string): Promise<ConsoleResult<T>> {
  if (!response.ok) {
    let message = httpStatus(response.status)
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
 * @param formatHttpStatus - renders the bare-status failure line in the
 *   operator's language (the locale dictionary's `api.httpStatus`); the
 *   registration wires it, bare callers get the status code itself.
 * @returns the API the Watch face performs its calls through.
 */
export function createConsoleApi(formatHttpStatus?: (status: number) => string): ConsoleApi {
  const base = CONSOLE_SHARE_PREFIX_ROUTE
  const httpStatus = formatHttpStatus ?? ((status: number) => String(status))
  return {
    listEngagements(signal) {
      return settle(fetch(`${base}/api/console/engagements`, { signal }).then(r => readJson<ConsoleEngagementsResponse>(r, httpStatus)))
    },
    models(signal) {
      return settle(fetch(`${base}/api/models`, { signal }).then(r => readJson<ModelsResponse>(r, httpStatus)))
    },
    abort(id, reason) {
      return settle(fetch(`${base}/api/engagements/${encodeURIComponent(id)}/abort`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      }).then(r => readJson<AbortOutcome>(r, httpStatus)))
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
      }).then(r => readJson<EscalateOutcome>(r, httpStatus)))
    },
    findings(id, signal) {
      return settle(fetch(`${base}/api/engagements/${encodeURIComponent(id)}/findings`, { signal }).then(r => readJson<readonly Finding[]>(r, httpStatus)))
    },
    proof(id, findingId, signal) {
      return settle(fetch(`${base}/api/engagements/${encodeURIComponent(id)}/proof/${encodeURIComponent(findingId)}`, { signal }).then(r => readJson<ProofBundle>(r, httpStatus)))
    },
    coverage(id, signal) {
      return settle(fetch(`${base}/api/engagements/${encodeURIComponent(id)}/coverage`, { signal }).then(r => readJson<Coverage>(r, httpStatus)))
    },
    compliance(id, signal) {
      return settle(fetch(`${base}/api/engagements/${encodeURIComponent(id)}/compliance`, { signal }).then(r => readJson<Compliance>(r, httpStatus)))
    },
    reverify(input) {
      return settle(fetch(`${base}/api/reverify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: input.id,
          finding: input.finding,
          ...(input.execute === true ? { execute: true } : {}),
          ...(input.scope !== undefined ? { scope: input.scope } : {}),
        }),
      }).then(r => readJson<ReverifyStart>(r, httpStatus)))
    },
    job(jobId, signal) {
      return settle(fetch(`${base}/api/jobs/${encodeURIComponent(jobId)}`, { signal }).then(r => readJson<JobRecord>(r, httpStatus)))
    },
    detail(id, signal) {
      return settle(fetch(`${base}/api/engagements/${encodeURIComponent(id)}`, { signal }).then(r => readJson<EngagementDetail>(r, httpStatus)))
    },
    foundry(signal) {
      return settle(fetch(`${base}/api/foundry`, { signal }).then(r => readJson<FoundryState>(r, httpStatus)))
    },
    foundryAction(kind) {
      return settle(fetch(`${base}/api/foundry/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }).then(r => readJson<FoundryActionResult>(r, httpStatus)))
    },
    arsenal(tool, args) {
      return settle(fetch(`${base}/arsenal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool, arguments: args }),
      }).then(r => readJson(r, httpStatus)))
    },
    scope(signal) {
      return settle(fetch(`${base}/api/console/scope`, { signal }).then(r => readJson<ScopeAggregate>(r, httpStatus)))
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
