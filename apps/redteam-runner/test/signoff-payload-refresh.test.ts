/**
 * S2-H6 — sign-off re-review must judge the post-redirect payload.
 *
 * The defect (comm-flow audit slice 2, Hop 6; or12's recon gate): the three
 * run.ts call sites built the sign-off payload string ONCE, and after a
 * REDIRECT's corrective work coordinatorSignOff recursed with that same
 * string — so the re-review re-judged the pre-redirect brief / target map /
 * counts even though the corrective loop had just produced new work. In
 * or12 the second recon→exploit review was handed the empty-map,
 * zero-receipt payload while the re-recon loop had already run.
 *
 * The fix: coordinatorSignOff takes a payload factory `() => string` and
 * invokes it at the top of every review pass, so each re-review is built
 * from live ctx state at that moment.
 *
 * These tests drive the real coordinatorSignOff through the scripted
 * deps.completeForRole seam (the signoff-redirect-budget fixture shape).
 * The scripted corrective loops mutate the payload's source state the way
 * the real corrective tools do (re-recon writes the shared target map;
 * focused exploitation records verdicts) — from inside the completion
 * seam, because that is where the corrective agent's turns happen.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ChatResult } from '@secscan/redteam-llm-router'
import { coordinatorSignOff } from '../src/phases/signoff.js'
import { EventLog, readEvents } from '../src/events.js'
import type { EngagementEvent } from '../src/types.js'
import type { Ctx } from '../src/context.js'
import type { SignOffTransition } from '../src/phases/exploit-one.js'
import type { BatteryCategory } from '../src/battery.js'

let dir = ''
beforeEach(() => {
  dir = join(tmpdir(), `signoff-payload-refresh-${process.pid}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const noRedirects = (): Record<SignOffTransition, number> => ({
  'plan→recon': 0,
  'recon→exploit': 0,
  'exploit→report': 0,
})

type CompleteFn = (
  role: unknown,
  messages: Array<{ role: string; content: string }>,
  opts?: { responseFormat?: { type: string } },
) => Promise<ChatResult>

const reply = (text: string): ChatResult => ({ text, toolCalls: [], provider: 'fake', model: 'fake' })

/** A loop-ready fake Ctx (signoff-redirect-budget fixture shape). */
function makeCtx(eventsDir: string, completeForRole: CompleteFn): Ctx {
  return {
    actions: 0,
    consecutive5xx: 0,
    deniedStreak: 0,
    redirects: noRedirects(),
    wallRedirects: 0,
    startedAt: Date.now(),
    hosts: ['shop.example.test'],
    domain: 'shop.example.test',
    config: { maxActions: 1000, maxDurationMs: 60_000, dryRunAgents: false, localSandbox: false },
    input: {
      target: 'https://shop.example.test',
      mode: 'red',
      objective: 'assess the shop',
      roe: { blackoutWindows: [], scope: ['shop.example.test'] },
      fullBattery: false,
    },
    deps: { completeForRole },
    events: new EventLog(eventsDir, 'eng-signoff-payload-refresh', {
      target: 'shop.example.test',
      mode: 'red',
      objective: 'assess the shop',
    }),
    coverage: new Set(),
    targetCoverage: new Map(),
    itemLedger: new Map(),
    registryHits: [],
    probesUsed: 0,
    opsecCooldown: new Set(),
    liveFindings: [],
    killedLive: [],
    targetMap: [],
    plan: null,
    fingerprint: { stack: [], appType: 'unknown' },
    tier: { current: 0, chainSteps: new Map<string, number>() },
    safety: { killSwitchAborts: 0 },
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
  } as unknown as Ctx
}

function eventsOf(action: string): EngagementEvent[] {
  return readEvents(dir).filter(e => e.action === action)
}

/**
 * A completion seam that answers sign-off reviews from a per-transition
 * reply script (the last reply repeats), records every sign-off review's
 * USER message (the payload lives there), and runs `onCorrective` when the
 * redirect's corrective loop calls back — the moment the real corrective
 * work would mutate shared state.
 */
function scriptedSeam(
  script: Partial<Record<SignOffTransition, string[]>>,
  onCorrective: (marker: string) => void,
): { completeForRole: CompleteFn; signOffUsers: string[] } {
  const signOffUsers: string[] = []
  const calls = new Map<SignOffTransition, number>()
  const completeForRole: CompleteFn = async (_role, messages) => {
    const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n')
    const m = userText.match(/Transition awaiting sign-off: (\S+)/)
    if (m) {
      signOffUsers.push(userText)
      const transition = m[1] as SignOffTransition
      const n = (calls.get(transition) ?? 0) + 1
      calls.set(transition, n)
      if (n > 6) return reply('SIGN-OFF: forced stop')
      const queue = script[transition] ?? ['SIGN-OFF: approved']
      return reply(queue[Math.min(n - 1, queue.length - 1)]!)
    }
    if (userText.includes('COMMANDER REDIRECT')) onCorrective(userText)
    return reply('corrective work done')
  }
  return { completeForRole, signOffUsers }
}

describe('coordinatorSignOff — re-review payload is rebuilt after a redirect (S2-H6)', () => {
  it('recon→exploit: the re-review after re-recon carries the NEW target map, registry count and fingerprint — not the empty pre-redirect payload (or12)', async () => {
    let ctx: Ctx
    const { completeForRole, signOffUsers } = scriptedSeam(
      { 'recon→exploit': ['REDIRECT: recon missed endpoints — re-run recon', 'SIGN-OFF: approved'] },
      () => {
        // The re-recon loop's discoveries, as update_target_map / the
        // registry consult / fingerprint parsing would have written them.
        ctx.targetMap.push(
          { method: 'GET', area: '/api/orders', authState: 'user-a', attackId: 'A01' },
          { method: 'POST', area: '/api/refund', authState: 'user-b' },
        )
        ctx.registryHits.push({
          id: 'hit-1',
          date: '2026-11-02T00:00:00.000Z',
          engagementId: 'eng-signoff-payload-refresh',
          target: { host: 'shop.example.test', stack: ['nginx'], appType: 'spa' },
          kind: 'killed',
          hypothesis: 'default creds on /api/orders',
          killingObservation: 'login rejected the default pair',
        })
        ctx.fingerprint.stack.push('nginx')
        ctx.fingerprint.appType = 'spa'
      },
    )
    ctx = makeCtx(dir, completeForRole)

    // The run.ts recon→exploit payload expression, as a factory over the
    // same sources (brief text is a run.ts local — see the builder report
    // for the disclosed residue; map / hits / fingerprint are ctx state).
    const brief = 'initial recon brief'
    let factoryCalls = 0
    const payloadFactory = (): string => {
      factoryCalls++
      return (
        `Recon brief:\n${brief}\n\nShared target map (${ctx.targetMap.length} entries):\n` +
        `${ctx.targetMap.map(t => `- ${t.method} ${t.area}${t.authState ? ` [${t.authState}]` : ''}${t.attackId ? ` ${t.attackId}` : ''}`).join('\n') || '(empty)'}\n` +
        `Registry hits consulted: ${ctx.registryHits.length}. Fingerprint: ${JSON.stringify(ctx.fingerprint)}`
      )
    }

    await coordinatorSignOff(ctx, 'recon→exploit', payloadFactory)

    assert.equal(eventsOf('redirect_rerecon').length, 1, "the redirect's re-recon ran between the reviews")
    assert.equal(signOffUsers.length, 2, 'the gate reviewed twice: initial + re-review')
    assert.equal(factoryCalls, 2, 'the payload factory was re-invoked for the re-review')

    const first = signOffUsers[0] ?? ''
    const second = signOffUsers[1] ?? ''
    assert.match(first, /Shared target map \(0 entries\)/, 'the first review saw the pre-redirect state')
    assert.match(first, /\(empty\)/)
    assert.match(first, /Registry hits consulted: 0/)

    assert.notEqual(second, first, 'the re-review payload is NOT the identical pre-redirect string')
    assert.match(second, /Shared target map \(2 entries\)/, 'the re-review carries the NEW map size')
    assert.match(second, /\/api\/orders/, 'the re-review carries the re-recon discoveries')
    assert.match(second, /\/api\/refund/)
    assert.doesNotMatch(second, /\(empty\)/)
    assert.match(second, /Registry hits consulted: 1/, 'the re-review carries the NEW registry count')
    assert.match(second, /nginx/, 'the re-review carries the NEW fingerprint')
    assert.match(second, /"appType":"spa"/)
  })

  it('exploit→report: the re-review after focused exploitation carries the NEW verdict counts and battery coverage', async () => {
    let ctx: Ctx
    const { completeForRole, signOffUsers } = scriptedSeam(
      { 'exploit→report': ['REDIRECT: zero tasks cannot advance to report', 'SIGN-OFF: approved'] },
      () => {
        // Focused exploitation's verdicts, as record_finding /
        // record_killed would have written them.
        ctx.liveFindings.push(
          { severity: 'high', title: 'IDOR on /api/orders', attackId: 'A01', evidence: 'receipt-1' },
          { severity: 'medium', title: 'Refund race', attackId: 'A04', evidence: 'receipt-2' },
        )
        ctx.killedLive.push({ hypothesis: 'SQLi on /api/search', killingObservation: 'parameterised query observed' })
        ctx.coverage.add('logic')
        ctx.coverage.add('validation')
      },
    )
    ctx = makeCtx(dir, completeForRole)

    // The run.ts exploit→report payload expression, as a factory over the
    // same sources (summary text is a run.ts local — disclosed residue;
    // verdict counts and coverage are ctx state).
    const summary = 'initial exploitation summary'
    let factoryCalls = 0
    const payloadFactory = (): string => {
      factoryCalls++
      return (
        `Exploitation summary:\n${summary}\n\nVerdicts — confirmed: ${ctx.liveFindings.length}, killed: ${ctx.killedLive.length}.\n` +
        `Battery: ${(['logic', 'functionality', 'validation'] as BatteryCategory[]).map(c => `${c}:${ctx.coverage.has(c) ? 'yes' : 'no'}`).join(', ')}.`
      )
    }

    await coordinatorSignOff(ctx, 'exploit→report', payloadFactory)

    assert.equal(eventsOf('redirect_exploit').length, 1, "the redirect's focused exploitation ran between the reviews")
    assert.equal(signOffUsers.length, 2, 'the gate reviewed twice: initial + re-review')
    assert.equal(factoryCalls, 2, 'the payload factory was re-invoked for the re-review')

    const first = signOffUsers[0] ?? ''
    const second = signOffUsers[1] ?? ''
    assert.match(first, /confirmed: 0, killed: 0/, 'the first review saw the pre-redirect counts')
    assert.match(first, /logic:no/)

    assert.notEqual(second, first, 'the re-review payload is NOT the identical pre-redirect string')
    assert.match(second, /confirmed: 2, killed: 1/, 'the re-review carries the NEW verdict counts')
    assert.doesNotMatch(second, /confirmed: 0, killed: 0/)
    assert.match(second, /logic:yes/, 'the re-review carries the NEW battery coverage')
    assert.match(second, /validation:yes/)
  })
})
