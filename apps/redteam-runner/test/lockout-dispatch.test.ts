/**
 * Q-LOCKOUT — credential-attempt interlock, dispatch integration suite
 * (spec: lockout-spec-2026-10-31.md §7.4/§7.10–7.12; pair build, Agent B).
 *
 * Drives REAL dispatchTool calls through a fake ctx carrying the REAL
 * CredentialAttemptGuard, TargetRateLimiter, and TargetAutoHalt, with the
 * host executor stubbed to canned summaries. Pins the choke-point wiring:
 * the gate sits after scope + auto-halt + the duplicate guard and before
 * limiter.acquire (a lockout refusal consumes no rate token), refusals are
 * result strings (never throws), the campaign ceiling refuses through the
 * router with a lockout_tripped event, a lockout signal trips the host
 * across protocols, and resume is a recorded operator decision — there is
 * no agent path back in.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchTool } from '../src/dispatch/router.js'
import { CredentialAttemptGuard } from '../src/safety/lockout.js'
import { TargetAutoHalt } from '../src/safety/autohalt.js'
import { TargetRateLimiter } from '../src/safety/ratelimit.js'
import type { Ctx } from '../src/context.js'
import type { ToolCallRequest } from '@secscan/redteam-llm-router'

interface ExecResult {
  summary: string
  output?: string
  ok: boolean
}

interface FakeEvents {
  action: string
  result: string
  target?: string
}

const FAIL_SSH: ExecResult = { summary: 'ssh {host} failed: Permission denied (password)', ok: false }
const LOCKED_SSH: ExecResult = { summary: 'ssh {host} failed: Account locked due to 5 failed logins (pam_faillock)', ok: false }
const CLEAN_SSH: ExecResult = { summary: 'ssh session established on {host}', ok: true }
const LOCKED_SMB: ExecResult = { summary: 'smb {host} session-setup failed: STATUS_ACCOUNT_LOCKED_OUT (0xC0000234)', ok: false }

function fakeCtx(opts: {
  scope: string[]
  outOfScope?: string[]
  guard?: CredentialAttemptGuard
  sshResults?: ExecResult[]
  smbResults?: ExecResult[]
}) {
  const appended: FakeEvents[] = []
  const sshCommands: string[] = []
  const smbCommands: string[] = []
  const probes: Array<{ url: string }> = []
  const guard = opts.guard ?? new CredentialAttemptGuard()
  // Frozen clock + deep burst: the limiter never sleeps in tests, and
  // `acquires` is the counter §7.10 reads.
  const limiter = new TargetRateLimiter({ rpsPerHost: 1000, burst: 1000 }, () => 0)
  const autoHalt = new TargetAutoHalt()
  const sshQueue = [...(opts.sshResults ?? [CLEAN_SSH])]
  const smbQueue = [...(opts.smbResults ?? [CLEAN_SSH])]
  const next = (q: ExecResult[], host: string): ExecResult => {
    const r = (q.length > 1 ? q.shift() : q[0])!
    return { ...r, summary: r.summary.replaceAll('{host}', host) }
  }
  const ctx = {
    input: { mode: 'red', roe: { scope: opts.scope, outOfScope: opts.outOfScope }, fullBattery: false },
    hosts: opts.scope,
    events: {
      dir: '/tmp/lockout-dispatch-test-no-such-dir',
      engagementId: 'eng-lockout-test',
      append: (e: FakeEvents) => appended.push(e),
    },
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
    tier: { current: 2, declared: 2, chainSteps: new Map<string, number>() },
    safety: { limiter, autoHalt, lockout: guard, killSwitchAborts: 0, rpsPerHost: 5 },
    itemLedger: new Map(),
    opsecCooldown: new Set<string>(),
    coverage: new Set<string>(),
    targetCoverage: new Map(),
    probesUsed: 0,
    consecutive5xx: 0,
    prober: {
      probe: async (req: { url: string }) => {
        probes.push(req)
        return { status: 200, ms: 1, bodySnippet: 'ok' }
      },
    },
    hostExecutor: {
      killSwitch: undefined,
      sshExec: async (a: { host: string; command: string }) => {
        sshCommands.push(a.command)
        return next(sshQueue, a.host)
      },
      smbExec: async (a: { host: string; command: string }) => {
        smbCommands.push(a.command)
        return next(smbQueue, a.host)
      },
    },
  } as unknown as Ctx
  return { ctx, appended, sshCommands, smbCommands, probes, guard, limiter, autoHalt }
}

const call = (name: string, args: Record<string, unknown>): ToolCallRequest =>
  ({ name, arguments: args }) as unknown as ToolCallRequest

/** Distinct command per call — the duplicate guard must never be what refuses these. */
const sshCall = (host: string, n: number) =>
  call('ssh_exec', { host, targetProfile: 'linux', command: `uname -a #${n}` })

const actions = (appended: FakeEvents[], action: string) => appended.filter(e => e.action === action)

describe('dispatch lockout gate — budget (spec §7.10)', () => {
  it('the fifth failed validation is refused before the limiter: no rate token, no packet, engagement continues', async () => {
    const host = 'app.example.com'
    const { ctx, appended, sshCommands, probes, guard, limiter } = fakeCtx({
      scope: [host],
      sshResults: [FAIL_SSH],
    })
    for (let n = 1; n <= 4; n++) {
      const r = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, n))
      assert.match(r.result, /Permission denied/, `call ${n} executes and fails validation`)
    }
    assert.equal(sshCommands.length, 4)
    assert.equal(limiter.acquires, 4, 'each admitted dispatch acquired exactly one rate token')
    assert.equal(guard.failuresFor(host, 'ssh'), 4)
    assert.equal(actions(appended, 'credential_attempt').length, 4)
    assert.equal(actions(appended, 'credential_attempt_outcome').length, 4)
    assert.ok(actions(appended, 'credential_attempt_outcome').every(e => /failed-validation/.test(e.result)))

    const refused = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, 5))
    assert.match(refused.result, /credential lockout interlock/)
    assert.match(refused.result, /app\.example\.com/)
    assert.equal(refused.target, host)
    assert.equal(sshCommands.length, 4, 'the refused call never reached the executor — no packet')
    assert.equal(limiter.acquires, 4, '§7.10: a budget refusal consumes NO limiter token')
    assert.equal(actions(appended, 'lockout_budget_exhausted').length, 1, 'the refusal is an audited event')
    assert.equal(guard.failuresFor(host, 'ssh'), 4, 'the refusal spent no budget')

    const probe = await dispatchTool(ctx, 'recon', 'recon', call('http_probe', { url: `https://${host}/` }))
    assert.equal(probes.length, 1, 'non-credential work against the same host continues')
    assert.doesNotMatch(probe.result, /lockout interlock/)
  })
})

describe('dispatch lockout gate — gate order (spec §7.11)', () => {
  it('a scope-denied Class A call touches no budget state', async () => {
    const { ctx, sshCommands, guard, limiter } = fakeCtx({ scope: ['app.example.com'], sshResults: [FAIL_SSH] })
    const r = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall('evil.example', 1))
    assert.match(r.result, /DENIED by scope/)
    assert.equal(sshCommands.length, 0)
    assert.equal(limiter.acquires, 0)
    assert.equal(guard.totalFailures(), 0)
    assert.equal(guard.ledger().length, 0, 'out-of-scope calls never reach the interlock')
  })

  it('an auto-halted host refuses on auto-halt, not on the interlock', async () => {
    const host = 'app.example.com'
    const { ctx, sshCommands, guard, limiter, autoHalt } = fakeCtx({ scope: [host], sshResults: [FAIL_SSH] })
    for (let i = 0; i < 5; i++) autoHalt.recordOutcome(host, true)
    assert.equal(autoHalt.isHalted(host), true)
    const r = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, 1))
    assert.match(r.result, /HALTED: target app\.example\.com was auto-halted/)
    assert.doesNotMatch(r.result, /lockout interlock/)
    assert.equal(sshCommands.length, 0)
    assert.equal(limiter.acquires, 0)
    assert.equal(guard.totalFailures(), 0)
    assert.equal(guard.ledger().length, 0, 'the interlock was never consulted')
  })
})

describe('dispatch lockout gate — campaign ceiling (spec §7.4, through the router)', () => {
  it('the ceiling-th failure across hosts trips credential testing engagement-wide', async () => {
    const [a, b, c] = ['a.example.com', 'b.example.com', 'c.example.com']
    const guard = new CredentialAttemptGuard({ lockoutThreshold: 50, totalFailureCeiling: 3 })
    const { ctx, appended, sshCommands, limiter } = fakeCtx({ scope: [a, b, c], guard, sshResults: [FAIL_SSH] })
    await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(a, 1))
    await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(a, 2))
    const third = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(b, 1))
    assert.match(third.result, /Permission denied/, 'the ceiling-th call itself still ran — the trip lands on its outcome')
    assert.equal(sshCommands.length, 3)
    assert.equal(guard.campaignTripped(), true)
    const trips = actions(appended, 'lockout_tripped')
    assert.equal(trips.length, 1)
    assert.match(trips[0]!.result, /CAMPAIGN LOCKOUT TRIP/)

    const acquiresBefore = limiter.acquires
    const refused = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(c, 1))
    assert.match(refused.result, /credential lockout interlock/)
    assert.match(refused.result, /campaign ceiling/)
    assert.equal(sshCommands.length, 3, 'a fresh host is refused too — the trip is engagement-wide')
    assert.equal(limiter.acquires, acquiresBefore, 'the ceiling refusal consumes no rate token')
    assert.equal(actions(appended, 'lockout_budget_exhausted').length, 0, 'ceiling refusals are not budget events')
  })
})

describe('dispatch lockout gate — signal trip + resume (spec §7.12)', () => {
  it('a lockout signal trips the host through dispatch; only a recorded decision lets work resume', async () => {
    const host = 'app.example.com'
    const { ctx, appended, sshCommands, guard } = fakeCtx({
      scope: [host],
      sshResults: [LOCKED_SSH, CLEAN_SSH],
    })
    const first = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, 1))
    assert.match(first.result, /pam_faillock/, 'the signalling call itself executed')
    assert.equal(guard.isTripped(host), true)
    assert.equal(actions(appended, 'lockout_signal_detected').length, 1)
    assert.equal(actions(appended, 'lockout_tripped').length, 1)

    const refused = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, 2))
    assert.match(refused.result, /credential lockout interlock/)
    assert.match(refused.result, /tripped/)
    assert.equal(sshCommands.length, 1, 'no further credential traffic reaches the tripped host')

    assert.throws(() => guard.reset(host, { by: 'human', rationale: '' }), /no rationale/)
    assert.equal(guard.isTripped(host), true, 'a rationale-less resume is not a decision')
    guard.reset(host, { by: 'human', rationale: 'AD admin confirmed the test account is unlocked; retest approved' })
    assert.equal(guard.isTripped(host), false)

    const after = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, 3))
    assert.match(after.result, /session established/)
    assert.equal(sshCommands.length, 2, 'credential work resumes only after the recorded decision')
    assert.ok(
      guard.ledger().some(e => e.outcome === 'lockout-signal'),
      'the ledger retains the pre-trip attempts — resume erases nothing',
    )
  })

  it('a signal on the smb key refuses ssh against the same host (cross-protocol, through the router)', async () => {
    const host = 'app.example.com'
    const { ctx, sshCommands, smbCommands, guard } = fakeCtx({
      scope: [host],
      smbResults: [LOCKED_SMB],
      sshResults: [CLEAN_SSH],
    })
    const smb = await dispatchTool(
      ctx,
      'exploiter',
      'exploit',
      call('smb_exec', { host, targetProfile: 'windows', command: 'net user' }),
    )
    assert.match(smb.result, /STATUS_ACCOUNT_LOCKED_OUT/)
    assert.equal(smbCommands.length, 1)
    assert.equal(guard.isTripped(host), true)

    const ssh = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, 1))
    assert.match(ssh.result, /credential lockout interlock/)
    assert.equal(sshCommands.length, 0, 'switching protocols does not help — the account counter is shared')
  })
})
