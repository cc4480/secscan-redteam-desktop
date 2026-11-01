/**
 * A scripted console API for the watch specs: canned list/models answers,
 * recorded control posts, and hand-driven feed connections. Every fixture
 * engagement is labelled a fixture in its id and target — nothing here
 * pretends to be a real run.
 */
import { vi } from 'vitest'
import type { ConsoleApi, ConsoleResult, FeedConnection, FeedHandlers, ReverifyInput, ReverifyStart } from '../src/client/api.ts'
import type {
  Compliance, Coverage, Finding, JobRecord, ProofBundle,
} from '../src/client/engagements-model.ts'
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

/** The fixture finding with a proof bundle (reverify-capable). */
export const FINDING_WITH_PROOF: Finding = {
  id: 'F-1',
  severity: 'high',
  title: 'Fixture: IDOR on the account endpoint',
  attackIds: ['A01'],
  evidence: 'Fixture evidence: a second account read the first account\'s record.',
  fix: 'Enforce per-object ownership checks on the account endpoint.',
  retest: 'Replay the cross-account read; expect 403.',
  status: 'confirmed',
  cellState: 'proven',
  cvss: 7.5,
  cwe: 'CWE-639',
  producer: 'exploiter',
  hasProof: true,
}

/** The fixture finding without a bundle (no proof affordances). */
export const FINDING_NO_PROOF: Finding = {
  id: 'F-2',
  severity: 'medium',
  title: 'Fixture: missing rate limit on login',
  attackIds: ['A07'],
  evidence: 'Fixture evidence: 200 login attempts in one minute accepted.',
  fix: 'Add progressive rate limiting to the login route.',
  retest: 'Repeat the burst; expect throttling.',
  status: 'confirmed',
  hasProof: false,
}

/** The fixture findings list for the live engagement. */
export const FINDINGS: readonly Finding[] = [FINDING_WITH_PROOF, FINDING_NO_PROOF]

/** The fixture proof bundle for F-1. */
export const PROOF_BUNDLE: ProofBundle = {
  version: 1,
  bundleId: 'bundle-fixture-1',
  engagementId: LIVE_ENGAGEMENT.id,
  findingId: 'F-1',
  attackIds: ['A01'],
  severity: 'high',
  title: FINDING_WITH_PROOF.title,
  target: 'fixture.invalid',
  operator: 'carlos',
  generatedAt: '2026-10-31T22:04:00.000Z',
  steps: [
    {
      seq: 1, ts: '2026-10-31T22:03:00.000Z', tool: 'http_probe', target: 'fixture.invalid',
      command: 'GET /api/accounts/2 (as account 1)', result: '200 with account 2 record (fixture)',
      validation: { marker: 'canary-fixture-1' }, marker: 'canary-fixture-1', replay: { kind: 'http' },
    },
  ],
  markerSent: 'canary-fixture-1',
  markerObserved: 'canary-fixture-1',
  validationTier: 'T2',
  proves: 'The account endpoint returns another account\'s record to any authenticated user (fixture).',
  doesNotProve: 'Write access or privilege escalation (fixture).',
  reverifyCommand: 'redteam reverify --bundle poc/F-1.json --execute',
}

/** The fixture coverage rollup. */
export const COVERAGE: Coverage = {
  cells: { logic: 1, functionality: 1, validation: 0 },
  total: 9,
  byDisposition: { proven: 2, clear: 6, pending: 1 },
  pending: ['A03:fixture-pending'],
  pendingTotal: 1,
}

/** The fixture compliance documents: pack + report written, the rest gaps. */
export const COMPLIANCE: Compliance = {
  packHtml: '<h1>Fixture evidence pack</h1><p>Fixture pack body.</p>',
  attestationHtml: null,
  safetyHtml: null,
  reportHtml: '<h1>Fixture report</h1><p>Fixture report body.</p>',
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
  readonly reverifies: ReverifyInput[]
  listCalls: number
  modelsCalls: number
  jobPolls: number
  /** Replace the list answer (or failure) for subsequent calls. */
  setList(result: ConsoleResult<ConsoleEngagementsResponse>): void
  /** Replace the abort outcome for subsequent calls. */
  setAbort(result: ConsoleResult<{ ok: boolean; id: string; via: string; note?: string }>): void
  /** Replace the job records served in order (the last one repeats). */
  setJobs(jobs: readonly JobRecord[]): void
}

/**
 * Build a scripted console with the fixture answers in force.
 * @returns the scripted console.
 */
export function scriptedConsole(): ScriptedConsole {
  const feeds: ScriptedFeed[] = []
  const aborts: { id: string; reason: string }[] = []
  const escalates: { id: string; input: EscalateInput }[] = []
  const reverifies: ReverifyInput[] = []
  let jobs: readonly JobRecord[] = [{
    id: 'job-fixture-1', kind: 'reverify', status: 'done', startedAt: '2026-10-31T22:06:00.000Z',
    finishedAt: '2026-10-31T22:06:30.000Z', result: { verdict: 'still-vulnerable', summary: 'Fixture verdict summary.' },
  }]
  let list: ConsoleResult<ConsoleEngagementsResponse> = { ok: true, value: LIST_RESPONSE }
  let abortOutcome: ConsoleResult<{ ok: boolean; id: string; via: string; note?: string }> = {
    ok: true,
    value: { ok: true, id: LIVE_ENGAGEMENT.id, via: 'abort.json', note: 'abort signal written' },
  }
  const scripted: ScriptedConsole = {
    feeds,
    aborts,
    escalates,
    reverifies,
    listCalls: 0,
    modelsCalls: 0,
    jobPolls: 0,
    setList(result) { list = result },
    setAbort(result) { abortOutcome = result },
    setJobs(next) { jobs = next },
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
      findings: vi.fn(async () => ({ ok: true, value: FINDINGS }) as ConsoleResult<readonly Finding[]>),
      proof: vi.fn(async () => ({ ok: true, value: PROOF_BUNDLE }) as ConsoleResult<ProofBundle>),
      coverage: vi.fn(async () => ({ ok: true, value: COVERAGE }) as ConsoleResult<Coverage>),
      compliance: vi.fn(async () => ({ ok: true, value: COMPLIANCE }) as ConsoleResult<Compliance>),
      reverify: vi.fn(async (input: ReverifyInput) => {
        reverifies.push(input)
        if (input.execute === true) return { ok: true, value: { jobId: 'job-fixture-1' } } as ConsoleResult<ReverifyStart>
        return {
          ok: true,
          value: {
            plan: true,
            bundleId: PROOF_BUNDLE.bundleId,
            findingId: input.finding,
            title: PROOF_BUNDLE.title,
            validationTier: PROOF_BUNDLE.validationTier,
            proves: PROOF_BUNDLE.proves,
            doesNotProve: PROOF_BUNDLE.doesNotProve,
            steps: PROOF_BUNDLE.steps.map(step => ({
              seq: step.seq, tool: step.tool, target: step.target,
              command: step.command, validation: step.validation, replayable: step.replay !== null,
            })),
          },
        } as ConsoleResult<ReverifyStart>
      }),
      job: vi.fn(async () => {
        scripted.jobPolls++
        const record = jobs[Math.min(scripted.jobPolls - 1, jobs.length - 1)] ?? jobs[0]!
        return { ok: true, value: record } as ConsoleResult<JobRecord>
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
