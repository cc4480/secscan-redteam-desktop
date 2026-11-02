/**
 * Q-FLEET-XCHECK — the fleet peer cross-check (spec:
 * fleet-peer-cross-check-2026-10-31.md).
 *
 * The acceptance, pinned: a produced finding is challenged by a
 * DIFFERENT seat than its producer, and the challenge outcome changes
 * what reaches the reporter — upheld flows stamped, downgraded is
 * stamped down to the checker's rung, killed/deferred are stamped out
 * of the confirmed flow. A same-seat challenge is impossible by
 * construction (checker selection excludes the producer; the fixture
 * also records every role the completion seam was called with). The
 * challenge exchange is in the engagement log (real EventLog on disk).
 * Fakes only — the model is a scripted deps seam, no network.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRole, ChatMessage, ChatResult } from '@secscan/redteam-llm-router'
import { EventLog } from '../src/events.js'
import { parsePeerVerdict, peerReviewPhase, selectChecker } from '../src/phases/peer-review.js'
import { applyPeerVerdicts } from '../src/report/peer-verdicts.js'
import { handleBookkeepingTools } from '../src/dispatch/bookkeeping.js'
import { seedRegistry } from '../src/registry.js'
import type { Ctx, LiveFinding } from '../src/context.js'
import type { ActorRole, EngagementEvent, Finding } from '../src/types.js'

type ScriptAnswer = { verdict: string; severity?: string; rationale?: string } | string | Error
type Script = Array<[needle: string, answer: ScriptAnswer]>

function live(over: Partial<LiveFinding> = {}): LiveFinding {
  return {
    severity: 'high',
    title: 'Untitled finding',
    attackId: 'T1190',
    evidence: 'recorded evidence',
    producer: 'exploiter',
    ...over,
  }
}

function makeCtx(liveFindings: LiveFinding[], script: Script) {
  const dir = mkdtempSync(join(tmpdir(), 'xcheck-'))
  const events = new EventLog(dir, 'eng-xcheck', { target: 'target.example', mode: 'red', objective: 'fixture' })
  const seenRoles: AgentRole[] = []
  const completeForRole = async (role: AgentRole, messages: ChatMessage[]): Promise<ChatResult> => {
    seenRoles.push(role)
    const user = messages.find((m) => m.role === 'user')?.content ?? ''
    for (const [needle, answer] of script) {
      if (!user.includes(needle)) continue
      if (answer instanceof Error) throw answer
      const text = typeof answer === 'string' ? answer : JSON.stringify(answer)
      return { text, toolCalls: [], provider: 'fake', model: 'fake' }
    }
    throw new Error(`unscripted challenge: ${user.slice(0, 80)}`)
  }
  const ctx = {
    input: { target: 'target.example', mode: 'red', roe: { scope: ['target.example'] } },
    config: { dryRunAgents: false },
    deps: { completeForRole },
    events,
    hosts: ['target.example'],
    domain: 'target.example',
    fingerprint: { host: 'target.example', stack: [], appType: 'unknown' },
    registry: seedRegistry(),
    registryPath: join(dir, 'registry.json'),
    liveFindings,
    killedLive: [],
    peerKilledLive: [],
    peerDeferredLive: [],
  } as unknown as Ctx
  const log = (): EngagementEvent[] =>
    readFileSync(join(dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as EngagementEvent)
  return { ctx, events, seenRoles, log }
}

function reportFinding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'F-1',
    severity: 'high',
    title: 'Untitled finding',
    attackIds: ['T1190'],
    evidence: 'recorded evidence',
    fix: 'fix it',
    retest: 're-test it',
    status: 'confirmed',
    ...over,
  }
}

describe('selectChecker — producer and checker are never the same seat', () => {
  it('excludes the producer for every seat, with architect as the default reviewer', () => {
    const producers: Array<ActorRole | undefined> = ['coordinator', 'recon', 'exploiter', 'reporter', 'architect', 'runner', undefined]
    for (const p of producers) {
      assert.notEqual(selectChecker(p), p, `checker must differ from producer ${String(p)}`)
    }
    assert.equal(selectChecker('exploiter'), 'architect')
    assert.equal(selectChecker(undefined), 'architect')
    // The review owner cannot check its own work: coordinator steps in.
    assert.equal(selectChecker('architect'), 'coordinator')
  })
})

describe('parsePeerVerdict — off-shape answers are not verdicts', () => {
  it('parses a bare JSON verdict and a fenced one', () => {
    assert.deepEqual(parsePeerVerdict('{"verdict":"upheld","rationale":"evidence proves it"}'), {
      verdict: 'upheld',
      severity: undefined,
      rationale: 'evidence proves it',
    })
    assert.equal(parsePeerVerdict('```json\n{"verdict":"killed","rationale":"benign"}\n```')?.verdict, 'killed')
  })

  it('rejects garbage and unknown verdicts', () => {
    assert.equal(parsePeerVerdict('the finding looks fine to me'), null)
    assert.equal(parsePeerVerdict('{"verdict":"shrug","rationale":"?"}'), null)
    assert.equal(parsePeerVerdict('{"rationale":"no verdict field"}'), null)
  })
})

describe('record_finding stamps the producer from the dispatch role', () => {
  it('producer is the calling seat, never a model argument', async () => {
    const { ctx } = makeCtx([], [])
    const args = { severity: 'high', title: 'Stamped finding', attackId: 'T1190', evidence: 'ev', producer: 'architect' }
    const res = await handleBookkeepingTools(ctx, 'exploiter', 'exploit', { id: 'call-1', name: 'record_finding', arguments: args }, args)
    assert.ok(res)
    assert.equal(ctx.liveFindings.length, 1)
    assert.equal(ctx.liveFindings[0]!.producer, 'exploiter')
  })
})

describe('the reviewer pass — outcomes change what reaches the reporter', () => {
  it('upheld flows, downgrade stamps down, kill and defer stamp out — all by a different seat', async () => {
    const findings = [
      live({ title: 'SQL injection in login', severity: 'high' }),
      live({ title: 'Missing TLS on admin panel', severity: 'critical' }),
      live({ title: 'Reflected XSS in search', severity: 'medium' }),
      live({ title: 'Weak session cookie flags', severity: 'low', producer: 'architect' }),
    ]
    const { ctx, seenRoles, log } = makeCtx(findings, [
      ['SQL injection in login', { verdict: 'upheld', rationale: 'error-based proof in evidence' }],
      ['Missing TLS on admin panel', { verdict: 'downgraded', severity: 'medium', rationale: 'login is behind SSO; impact overstated' }],
      ['Reflected XSS in search', { verdict: 'killed', rationale: 'marker reflected inside an escaped attribute — benign' }],
      ['Weak session cookie flags', { verdict: 'needs-evidence', rationale: 'no session fixation demonstrated' }],
    ])
    await peerReviewPhase(ctx)

    // Every challenge went to a seat other than the finding's producer:
    // architect reviews the exploiter's three; the architect's own
    // finding is reviewed by the coordinator.
    assert.deepEqual(seenRoles, ['architect', 'architect', 'architect', 'coordinator'])

    // Confirmed flow: upheld + downgraded only.
    assert.deepEqual(ctx.liveFindings.map((f) => f.title), ['SQL injection in login', 'Missing TLS on admin panel'])
    const [a, b] = ctx.liveFindings
    assert.equal(a!.peerReview?.verdict, 'upheld')
    assert.equal(a!.peerReview?.disposition, 'flows')
    assert.equal(a!.peerReview?.checker, 'architect')
    assert.equal(b!.severity, 'medium')
    assert.equal(b!.peerReview?.disposition, 'downgraded')
    assert.equal(b!.peerReview?.fromSeverity, 'critical')
    assert.equal(b!.peerReview?.toSeverity, 'medium')

    // Killed: out of the flow, into the killed record + registry.
    assert.equal(ctx.peerKilledLive.length, 1)
    assert.equal(ctx.peerKilledLive[0]!.peerReview?.disposition, 'killed')
    assert.equal(ctx.killedLive.length, 1)
    assert.match(ctx.killedLive[0]!.killingObservation, /Peer-review kill by architect/)
    assert.ok(ctx.registry.killed.some((e) => e.hypothesis === 'Reflected XSS in search'))

    // Deferred: out of the flow, stamped, checked by the coordinator.
    assert.equal(ctx.peerDeferredLive.length, 1)
    assert.equal(ctx.peerDeferredLive[0]!.peerReview?.checker, 'coordinator')
    assert.equal(ctx.peerDeferredLive[0]!.peerReview?.disposition, 'deferred')

    // The exchange is in the engagement log, in plain sight.
    const events = log()
    const challenges = events.filter((e) => e.action === 'peer_challenge')
    assert.equal(challenges.length, 4)
    const challengerOf = new Map(challenges.map((e) => [e.result.match(/"([^"]+)"/)?.[1], e.actor]))
    assert.equal(challengerOf.get('SQL injection in login'), 'architect')
    assert.equal(challengerOf.get('Weak session cookie flags'), 'coordinator')
    assert.equal(events.filter((e) => e.action === 'peer_verdict').length, 4)
    const summary = events.find((e) => e.action === 'peer_review_complete')
    assert.match(summary!.result, /4 challenged — 1 upheld, 1 downgraded, 1 deferred, 1 killed, 0 unchallenged/)

    // Reporter intake: the parsed findings are stamped from the live
    // record — the downgrade is forced to the stamped rung even though
    // the reporter restated the old severity, and the killed/deferred
    // matches are stamped out/down.
    const parsed: Finding[] = [
      reportFinding({ id: 'F-1', title: 'SQL injection in login', severity: 'high' }),
      reportFinding({ id: 'F-2', title: 'Missing TLS on admin panel', severity: 'critical' }),
      reportFinding({ id: 'F-3', title: 'Reflected XSS in search', severity: 'medium' }),
      reportFinding({ id: 'F-4', title: 'Weak session cookie flags', severity: 'low' }),
      reportFinding({ id: 'F-5', title: 'Reporter-only invention', severity: 'low' }),
    ]
    applyPeerVerdicts(parsed, { live: ctx.liveFindings, killed: ctx.peerKilledLive, deferred: ctx.peerDeferredLive })
    assert.equal(parsed[0]!.producer, 'exploiter')
    assert.equal(parsed[0]!.peerReview?.verdict, 'upheld')
    assert.equal(parsed[1]!.severity, 'medium')
    assert.equal(parsed[1]!.peerReview?.disposition, 'downgraded')
    assert.equal(parsed[2]!.status, 'killed')
    assert.equal(parsed[2]!.peerReview?.checker, 'architect')
    assert.equal(parsed[3]!.status, 'deferred')
    assert.equal(parsed[3]!.producer, 'architect')
    assert.equal(parsed[3]!.peerReview?.checker, 'coordinator')
    // A miss never fabricates a challenge.
    assert.equal(parsed[4]!.peerReview, undefined)
    assert.equal(parsed[4]!.status, 'confirmed')
  })

  it('a PROVEN cell verdict outranks a peer kill (proven wins)', async () => {
    const { ctx, log } = makeCtx(
      [live({ title: 'Proven RCE', cellState: 'proven', provenClaim: { expectedMarker: 'M-1', targetUrl: 'https://target.example/' } })],
      [['Proven RCE', { verdict: 'killed', rationale: 'looks like a scanner artifact' }]],
    )
    await peerReviewPhase(ctx)
    assert.equal(ctx.liveFindings.length, 1)
    assert.equal(ctx.peerKilledLive.length, 0)
    assert.equal(ctx.killedLive.length, 0)
    assert.equal(ctx.liveFindings[0]!.peerReview?.verdict, 'killed')
    assert.equal(ctx.liveFindings[0]!.peerReview?.disposition, 'flows')
    const verdict = log().find((e) => e.action === 'peer_verdict')
    assert.match(verdict!.result, /proven wins/)
  })

  it('a downgrade at the severity floor flows unchanged, with the reason on the stamp', async () => {
    const { ctx } = makeCtx(
      [live({ title: 'Informational banner', severity: 'info' })],
      [['Informational banner', { verdict: 'downgraded', severity: 'info', rationale: 'barely worth ink' }]],
    )
    await peerReviewPhase(ctx)
    assert.equal(ctx.liveFindings.length, 1)
    assert.equal(ctx.liveFindings[0]!.severity, 'info')
    assert.equal(ctx.liveFindings[0]!.peerReview?.disposition, 'flows')
    assert.match(ctx.liveFindings[0]!.peerReview!.rationale, /severity floor/)
  })

  it('checker failure and unparseable answers flow unstamped — never fabricated, never a halt', async () => {
    const { ctx, log } = makeCtx(
      [live({ title: 'Finding one' }), live({ title: 'Finding two' }), live({ title: 'Finding three' })],
      [
        ['Finding one', new Error('provider safety rejection (simulated)')],
        ['Finding two', 'I reviewed it and it seems fine, trust me'],
        ['Finding three', { verdict: 'upheld', rationale: 'proof is in the record' }],
      ],
    )
    await peerReviewPhase(ctx)
    assert.equal(ctx.liveFindings.length, 3)
    assert.equal(ctx.liveFindings[0]!.peerReview, undefined)
    assert.equal(ctx.liveFindings[1]!.peerReview, undefined)
    assert.equal(ctx.liveFindings[2]!.peerReview?.verdict, 'upheld')
    const failures = log().filter((e) => e.action === 'peer_review_failed')
    assert.equal(failures.length, 2)
    assert.match(failures[0]!.result, /UNSTAMPED/)
    const summary = log().find((e) => e.action === 'peer_review_complete')
    assert.match(summary!.result, /2 unchallenged/)
  })

  it('the checker runs under the fleet-assembled ARCHITECT prompt when the record is stamped (H5)', async () => {
    const { ctx } = makeCtx(
      [live({ title: 'SQL injection in login' })],
      [['SQL injection in login', { verdict: 'upheld', rationale: 'proof in evidence' }]],
    )
    // Stamp the authorize record the way production carries it.
    const stamped = ctx as unknown as Record<string, unknown>
    stamped.verificationProof = 'DNS TXT record'
    stamped.verifiedAt = '2026-11-02T00:00:00.000Z'
    const systems: string[] = []
    const inner = ctx.deps.completeForRole!
    ctx.deps.completeForRole = (async (role: AgentRole, messages: ChatMessage[]) => {
      const sys = messages.find((m) => m.role === 'system')
      if (sys) systems.push(sys.content)
      return inner(role, messages)
    }) as typeof inner
    await peerReviewPhase(ctx)
    assert.equal(ctx.liveFindings[0]!.peerReview?.verdict, 'upheld', 'verdict mechanics unchanged')
    assert.equal(systems.length, 1)
    const system = systems[0]!
    assert.ok(system.includes('# The ARCHITECT — Evaluator / Reporter'), 'the ARCHITECT soul heads the checker prompt')
    assert.ok(system.includes('<verified_engagement>'), 'the attested record is injected, not a generic system')
    assert.ok(system.includes('engagement_id: eng-xcheck'), 'the record is this engagement\u2019s own')
    assert.ok(system.includes('PEER REVIEWER'), 'the challenge delta survives inside the assembly')
  })

  it('dry runs skip the pass entirely', async () => {
    const { ctx, seenRoles } = makeCtx([live({ title: 'Dry finding' })], [['Dry finding', { verdict: 'killed', rationale: 'x' }]])
    ctx.config.dryRunAgents = true
    await peerReviewPhase(ctx)
    assert.deepEqual(seenRoles, [])
    assert.equal(ctx.liveFindings.length, 1)
    assert.equal(ctx.liveFindings[0]!.peerReview, undefined)
  })
})
