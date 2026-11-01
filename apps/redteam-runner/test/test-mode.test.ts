/**
 * TEST MODE (REDTEAM_TEST_MODE, operator order) — the runner-side gates.
 *
 * Test mode is ONE posture switch (ResolvedRunnerConfig.testMode): while
 * testing, the mechanical restraints are bypassed for declared in-scope
 * targets and every bypass is event-logged; nothing is deleted, and off
 * means every gate behaves exactly as before. This suite pins:
 *  - config resolution (env, opt-in, explicit opt beats env);
 *  - authorize: test mode passes with the exact self-attestation and a
 *    test_mode_active event, while the SAME ctx (private host in scope)
 *    is denied without it (scope_authorization_denied);
 *  - techniqueAllowed: built-in exclusions (T1499, black-mode T1110) are
 *    bypassed in test mode, operator ROE exclusions still bind;
 *  - the rate limiter's disabled mode admits immediately;
 *  - msf policy: module denylist + payload policy bypassed in test mode,
 *    structural module validation (type) NOT bypassed;
 *  - dispatch: the credential lockout interlock refuses the fifth failed
 *    validation without test mode and lets it execute with test mode,
 *    leaving test_mode_bypass receipts and zero recorded failures.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../src/phases/config.js'
import { authorizePhase, TEST_MODE_ATTESTATION } from '../src/phases/authorize.js'
import { techniqueAllowed } from '../src/gate.js'
import { TargetRateLimiter } from '../src/safety/ratelimit.js'
import { CredentialAttemptGuard } from '../src/safety/lockout.js'
import { TargetAutoHalt } from '../src/safety/autohalt.js'
import { checkMsfModule, checkMsfPayload } from '../src/msf/policy.js'
import { dispatchTool } from '../src/dispatch/router.js'
import type { Ctx } from '../src/context.js'
import type { RulesOfEngagement } from '../src/types.js'
import type { ToolCallRequest } from '@secscan/redteam-llm-router'

describe('test mode — config resolution', () => {
  it('defaults off, env turns it on, an explicit opt beats the env', () => {
    // resolveConfig fails loud without a model key — a dummy key rides along.
    const KEY = { MODEL_API_KEY: 'test-key' }
    assert.equal(resolveConfig({ ...KEY }, {}).testMode, false)
    assert.equal(resolveConfig({ ...KEY, REDTEAM_TEST_MODE: '1' }, {}).testMode, true)
    assert.equal(resolveConfig({ ...KEY, REDTEAM_TEST_MODE: '0' }, {}).testMode, false)
    assert.equal(resolveConfig({ ...KEY, REDTEAM_TEST_MODE: '1' }, { testMode: false }).testMode, false)
    assert.equal(resolveConfig({ ...KEY }, { testMode: true }).testMode, true)
  })
})

function authorizeCtx(testMode: boolean) {
  const appended: Array<{ action: string; result: string }> = []
  const ctx = {
    domain: 'example.com',
    hosts: ['example.com', '192.168.1.10'],
    input: {
      mode: 'red',
      objective: 'test-mode authorize proof',
      operatorName: 'Test Operator',
      roe: { scope: ['example.com', '192.168.1.10'], outOfScope: [] },
    },
    config: { testMode, verifyViaService: false, mcpEndpoint: '', mcpToken: '', localSandbox: false },
    deps: {},
    events: {
      append: (e: { action: string; result: string }) => appended.push(e),
      updateState: () => undefined,
    },
  } as unknown as Ctx
  return { ctx, appended }
}

describe('test mode — authorize phase', () => {
  it('passes with the exact self-attestation and a test_mode_active event', async () => {
    const { ctx, appended } = authorizeCtx(true)
    const verdict = await authorizePhase(ctx)
    assert.equal(verdict.allowed, true)
    assert.equal(ctx.verificationProof, TEST_MODE_ATTESTATION)
    assert.equal(
      TEST_MODE_ATTESTATION,
      'TEST MODE: operator self-attested — ownership verification bypassed by operator order (REDTEAM_TEST_MODE)',
    )
    assert.equal(appended.filter(e => e.action === 'test_mode_active').length, 1)
  })

  it('the SAME private-in-scope ctx is denied without test mode', async () => {
    const { ctx, appended } = authorizeCtx(false)
    const verdict = await authorizePhase(ctx)
    assert.equal(verdict.allowed, false)
    assert.equal(appended.filter(e => e.action === 'scope_authorization_denied').length, 1)
    assert.equal(appended.filter(e => e.action === 'test_mode_active').length, 0)
  })
})

describe('test mode — techniqueAllowed', () => {
  const roe = { scope: ['app.example.com'], excludedTechniques: ['T1190'] } as unknown as RulesOfEngagement
  it('T1499 is excluded without test mode and allowed with it', () => {
    assert.equal(techniqueAllowed('T1499', 'red', roe), false)
    assert.equal(techniqueAllowed('T1499', 'red', roe, { testMode: true }), true)
  })
  it('black-mode default exclusion (T1110) is bypassed in test mode', () => {
    assert.equal(techniqueAllowed('T1110', 'black', roe), false)
    assert.equal(techniqueAllowed('T1110', 'black', roe, { testMode: true }), true)
  })
  it('operator ROE exclusions still bind in test mode', () => {
    assert.equal(techniqueAllowed('T1190', 'red', roe, { testMode: true }), false)
    assert.equal(techniqueAllowed('T1190', 'red', roe), false)
  })
})

describe('test mode — rate limiter disabled', () => {
  it('admits immediately past the burst; the enabled limiter does not', () => {
    const frozen = () => 0
    const disabled = new TargetRateLimiter({ rpsPerHost: 1, burst: 1, disabled: true }, frozen)
    assert.equal(disabled.tryAcquire('h'), true)
    assert.equal(disabled.tryAcquire('h'), true)
    assert.equal(disabled.acquires, 2)
    const enabled = new TargetRateLimiter({ rpsPerHost: 1, burst: 1 }, frozen)
    assert.equal(enabled.tryAcquire('h'), true)
    assert.equal(enabled.tryAcquire('h'), false)
  })
})

describe('test mode — msf policy', () => {
  it('module denylist is bypassed, structural type validation is not', () => {
    assert.match(checkMsfModule('auxiliary/dos/tcp/synflood', 'auxiliary') ?? '', /denylist/)
    assert.equal(checkMsfModule('auxiliary/dos/tcp/synflood', 'auxiliary', { testMode: true }), null)
    assert.match(checkMsfModule('post/windows/gather/hashdump', 'post', { testMode: true }) ?? '', /module type not allowed/)
    assert.match(checkMsfModule('', 'exploit', { testMode: true }) ?? '', /empty module name/)
  })
  it('payload policy returns null in test mode', () => {
    assert.match(checkMsfPayload('windows/x64/meterpreter/reverse_tcp') ?? '', /not allowed/)
    assert.equal(checkMsfPayload('windows/x64/meterpreter/reverse_tcp', { testMode: true }), null)
    assert.equal(checkMsfPayload('cmd/unix/generic'), null)
  })
})

interface ExecResult {
  summary: string
  output?: string
  ok: boolean
}

const FAIL_SSH: ExecResult = { summary: 'ssh {host} failed: Permission denied (password)', ok: false }

/** Modeled on test/lockout-dispatch.test.ts (real guard/limiter/auto-halt, stubbed executor). */
function fakeCtx(testMode: boolean) {
  const appended: Array<{ action: string; result: string; target?: string }> = []
  const sshCommands: string[] = []
  const guard = new CredentialAttemptGuard()
  const limiter = new TargetRateLimiter({ rpsPerHost: 1000, burst: 1000 }, () => 0)
  const host = 'app.example.com'
  const ctx = {
    input: { mode: 'red', roe: { scope: [host], outOfScope: [] }, fullBattery: false },
    hosts: [host],
    config: { testMode },
    events: {
      dir: '/tmp/test-mode-test-no-such-dir',
      engagementId: 'eng-test-mode-test',
      append: (e: { action: string; result: string; target?: string }) => appended.push(e),
    },
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
    tier: { current: 2, declared: 2, chainSteps: new Map<string, number>() },
    safety: { limiter, autoHalt: new TargetAutoHalt(), lockout: guard, killSwitchAborts: 0, rpsPerHost: 5 },
    itemLedger: new Map(),
    opsecCooldown: new Set<string>(),
    coverage: new Set<string>(),
    targetCoverage: new Map(),
    probesUsed: 0,
    consecutive5xx: 0,
    prober: {
      probe: async () => ({ status: 200, ms: 1, bodySnippet: 'ok' }),
    },
    hostExecutor: {
      killSwitch: undefined,
      sshExec: async (a: { host: string; command: string }) => {
        sshCommands.push(a.command)
        return { ...FAIL_SSH, summary: FAIL_SSH.summary.replaceAll('{host}', a.host) }
      },
    },
  } as unknown as Ctx
  return { ctx, appended, sshCommands, guard, host }
}

const sshCall = (host: string, n: number): ToolCallRequest =>
  ({ name: 'ssh_exec', arguments: { host, targetProfile: 'linux', command: `uname -a #${n}` } }) as unknown as ToolCallRequest

describe('test mode — dispatch lockout interlock', () => {
  it('without test mode the fifth failed validation is refused by the interlock', async () => {
    const { ctx, sshCommands, host } = fakeCtx(false)
    for (let n = 1; n <= 4; n++) {
      const r = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, n))
      assert.match(r.result, /Permission denied/, `call ${n} executes and fails validation`)
    }
    const refused = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, 5))
    assert.match(refused.result, /credential lockout interlock/)
    assert.equal(sshCommands.length, 4, 'the refused call never reached the executor')
  })

  it('with test mode the fifth call executes, with bypass receipts and zero recorded failures', async () => {
    const { ctx, appended, sshCommands, guard, host } = fakeCtx(true)
    for (let n = 1; n <= 5; n++) {
      const r = await dispatchTool(ctx, 'exploiter', 'exploit', sshCall(host, n))
      assert.match(r.result, /Permission denied/, `call ${n} executes (and fails validation) in test mode`)
    }
    assert.equal(sshCommands.length, 5, 'every call reached the executor')
    assert.ok(appended.filter(e => e.action === 'test_mode_bypass').length >= 1, 'bypass receipts were logged')
    assert.equal(appended.filter(e => e.action === 'lockout_budget_exhausted').length, 0)
    assert.equal(guard.totalFailures(), 0, 'the interlock recorded nothing — admission and outcome both skipped')
  })
})
