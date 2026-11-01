/**
 * A scripted console API for the watch specs: canned list/models answers,
 * recorded control posts, and hand-driven feed connections. Every fixture
 * engagement is labelled a fixture in its id and target — nothing here
 * pretends to be a real run.
 */
import { vi } from 'vitest'
import type { ConsoleApi, ConsoleResult, FeedConnection, FeedHandlers } from '../src/client/api.ts'
import type {
  ConsoleEngagement, ConsoleEngagementsResponse, EngagementEvent, EscalateInput, EscalateOutcome, ModelsResponse,
} from '../src/client/model.ts'

/** The live fixture engagement: the engagement's own tokens/steps/findings the body must show. */
export const LIVE_ENGAGEMENT: ConsoleEngagement = {
  id: 'eng-fixture-live',
  live: true,
  source: 'live',
  status: 'running',
  phase: 'exploit',
  target: 'fixture.invalid',
  mode: 'standard',
  startedAt: '2026-10-31T22:00:00.000Z',
  updatedAt: '2026-10-31T22:05:00.000Z',
  actions: 61,
  steps: 54,
  tokens: { in: 1_000_000, out: 234_567, total: 1_234_567 },
  durationMs: 300_000,
  findings: { total: 8, proven: 3, provenShare: 0.375 },
  verdicts: { total: 12, byDisposition: { proven: 3, clear: 9 } },
  layers: { ids: ['secscan', 'seclayer'], components: {} },
  hasReport: false,
}

/** The archived fixture engagement: complete, not live, no controls. */
export const DONE_ENGAGEMENT: ConsoleEngagement = {
  id: 'eng-fixture-done',
  live: false,
  source: 'archive',
  status: 'complete',
  phase: 'report',
  target: 'fixture-done.invalid',
  mode: 'standard',
  startedAt: '2026-10-31T20:00:00.000Z',
  updatedAt: '2026-10-31T20:30:00.000Z',
  actions: 120,
  steps: 120,
  tokens: { in: 2_000, out: 1_000, total: 3_000 },
  durationMs: 1_800_000,
  findings: { total: 2, proven: 2, provenShare: 1 },
  verdicts: null,
  layers: null,
  hasReport: true,
}

/** The list answer carrying both fixture engagements, live first. */
export const LIST_RESPONSE: ConsoleEngagementsResponse = {
  available: true,
  generatedAt: '2026-10-31T22:05:00.000Z',
  engagements: [LIVE_ENGAGEMENT, DONE_ENGAGEMENT],
}

/** The models answer: the fleet's five seats on Meta Muse Spark. */
export const MODELS_RESPONSE: ModelsResponse = {
  providers: [],
  activeProvider: 'meta',
  seats: ['coordinator', 'recon', 'exploiter', 'architect', 'reporter']
    .map(role => ({ role, provider: 'meta', model: 'muse-spark-1.3' })),
}

/**
 * One feed event fixture.
 * @param seq - its sequence number.
 * @param over - field overrides.
 * @returns the event record.
 */
export function feedEvent(seq: number, over: Partial<EngagementEvent> = {}): EngagementEvent {
  return {
    ts: '2026-10-31T22:05:00.000Z',
    seq,
    engagementId: LIVE_ENGAGEMENT.id,
    phase: 'exploit',
    actor: 'exploiter',
    action: 'http_probe',
    result: '200 OK',
    ...over,
  }
}

/** One scripted feed connection: the test drives its handlers by hand. */
export interface ScriptedFeed {
  readonly id: string
  readonly after: number
  closed: boolean
  /** Deliver one event as the server would. */
  emitEvent(event: EngagementEvent): void
  /** Deliver one state push. */
  emitState(state: { status: string; phase: string; eventCount: number }): void
  /** Deliver the terminal done. */
  emitDone(status: string): void
  /** Deliver a stream error. */
  emitError(): void
}

/** The scripted console: the API plus every hand on it. */
export interface ScriptedConsole {
  readonly api: ConsoleApi
  readonly feeds: ScriptedFeed[]
  readonly aborts: { id: string; reason: string }[]
  readonly escalates: { id: string; input: EscalateInput }[]
  listCalls: number
  modelsCalls: number
  /** Replace the list answer (or failure) for subsequent calls. */
  setList(result: ConsoleResult<ConsoleEngagementsResponse>): void
  /** Replace the abort outcome for subsequent calls. */
  setAbort(result: ConsoleResult<{ ok: boolean; id: string; via: string; note?: string }>): void
}

/**
 * Build a scripted console with the fixture answers in force.
 * @returns the scripted console.
 */
export function scriptedConsole(): ScriptedConsole {
  const feeds: ScriptedFeed[] = []
  const aborts: { id: string; reason: string }[] = []
  const escalates: { id: string; input: EscalateInput }[] = []
  let list: ConsoleResult<ConsoleEngagementsResponse> = { ok: true, value: LIST_RESPONSE }
  let abortOutcome: ConsoleResult<{ ok: boolean; id: string; via: string; note?: string }> = {
    ok: true,
    value: { ok: true, id: LIVE_ENGAGEMENT.id, via: 'abort.json', note: 'abort signal written' },
  }
  const scripted: ScriptedConsole = {
    feeds,
    aborts,
    escalates,
    listCalls: 0,
    modelsCalls: 0,
    setList(result) { list = result },
    setAbort(result) { abortOutcome = result },
    api: {
      listEngagements: vi.fn(async () => {
        scripted.listCalls++
        return list
      }),
      models: vi.fn(async () => {
        scripted.modelsCalls++
        return { ok: true, value: MODELS_RESPONSE } as ConsoleResult<ModelsResponse>
      }),
      abort: vi.fn(async (id: string, reason: string) => {
        aborts.push({ id, reason })
        return abortOutcome
      }),
      escalate: vi.fn(async (id: string, input: EscalateInput) => {
        escalates.push({ id, input })
        return {
          ok: true,
          value: {
            ok: true, engagementId: id, fromTier: '1', toTier: input.tier,
            operator: input.operator, engagementStatus: 'running', message: `tier set to ${input.tier}`,
          },
        } as ConsoleResult<EscalateOutcome>
      }),
      openFeed: vi.fn((id: string, after: number, handlers: FeedHandlers): FeedConnection => {
        const feed: ScriptedFeed = {
          id,
          after,
          closed: false,
          emitEvent: (event) => { handlers.onEvent(event) },
          emitState: (state) => { handlers.onState(state) },
          emitDone: (status) => { handlers.onDone(status) },
          emitError: () => { handlers.onError() },
        }
        feeds.push(feed)
        return {
          close() { feed.closed = true },
        }
      }),
    },
  }
  return scripted
}
