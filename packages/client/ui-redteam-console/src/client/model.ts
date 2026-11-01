/**
 * Wire types for the runner console's JSON, mirrored field-for-field from
 * the console's own route contracts (`apps/redteam-runner/src/ui/routes/*`
 * and `src/types.ts`). The console is the single authority for every value;
 * these types only name what its responses already carry. Fields the
 * console derives from artifacts are nullable exactly where the console
 * says they are — the UI shows what the artifacts say, never an estimate.
 */

/** One row of `GET /api/console/engagements` (the A4 console view). */
export interface ConsoleEngagement {
  readonly id: string
  readonly live: boolean
  readonly source: 'live' | 'archive'
  readonly status: string
  readonly phase: string
  readonly target: string
  readonly mode: string
  readonly startedAt: string
  readonly updatedAt: string
  /** Events recorded so far (`state.eventCount`). */
  readonly actions: number
  readonly steps: number | null
  readonly tokens: { readonly in: number; readonly out: number; readonly total: number } | null
  readonly durationMs: number | null
  readonly findings: {
    readonly total: number
    readonly proven: number
    readonly provenShare: number | null
  }
  readonly verdicts: { readonly total: number; readonly byDisposition: Record<string, number> } | null
  readonly layers: { readonly ids: readonly string[]; readonly components: Record<string, string> } | null
  readonly hasReport: boolean
  readonly error?: string
}

/** `GET /api/console/engagements` response body. */
export interface ConsoleEngagementsResponse {
  readonly available: boolean
  readonly reason?: string
  readonly generatedAt: string
  readonly engagements: readonly ConsoleEngagement[]
}

/** One fleet seat from `GET /api/models`: which provider/model a role runs. */
export interface ModelSeat {
  readonly role: string
  readonly provider: string
  readonly model: string
}

/** `GET /api/models` response body. */
export interface ModelsResponse {
  readonly providers: unknown
  readonly activeProvider: string | null
  readonly seats: readonly ModelSeat[]
}

/**
 * One engagement event record (one line of events.jsonl), as the feed's
 * `event` SSE messages carry it.
 */
export interface EngagementEvent {
  readonly ts: string
  readonly seq: number
  readonly engagementId: string
  readonly phase: string
  readonly actor: string
  readonly action: string
  readonly attackId?: string
  readonly target?: string
  readonly result: string
  readonly opsec?: string
  readonly causedBy?: number
}

/** The slice of the feed's `state` SSE pushes the Watch tab reads. */
export interface FeedState {
  readonly status: string
  readonly phase: string
  readonly eventCount: number
}

/** `POST /api/engagements/:id/abort` response body. */
export interface AbortOutcome {
  readonly ok: boolean
  readonly id: string
  readonly via: string
  readonly engagementStatus?: string
  readonly note?: string
}

/** `POST /api/engagements/:id/escalate` response body. */
export interface EscalateOutcome {
  readonly ok: boolean
  readonly engagementId: string
  readonly fromTier: 0 | 1 | 2
  readonly toTier: 0 | 1 | 2
  readonly operator: string
  readonly engagementStatus: string
  readonly message: string
}

/** The escalate form's values, mirroring the console UI's own prompts. */
export interface EscalateInput {
  readonly tier: string
  readonly operator: string
  readonly reason: string
}
