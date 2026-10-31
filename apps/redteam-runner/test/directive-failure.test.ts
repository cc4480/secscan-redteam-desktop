/**
 * Q-HALT Item 4 — a failed coordinator directive call closes the exploit
 * phase honestly (directive_failed + battery NOT COMPLETE + normal return)
 * instead of halting the whole engagement. The fixture is the brief §8
 * synthetic incident: an HTTP 400 safety rejection (code safety_blocked,
 * wording outside the pre-fix classifier tables) wrapped by the executor
 * into a ResilienceError after 1 attempt.
 *
 * RECONSTRUCTION NOTE: this file was re-derived by Agent A from the pair
 * brief (§7/§8) and Agent B's build-log description after B's parked copy
 * was lost with B's session; it implements the same three tests B recorded
 * (wrapper null + directive_failed, HaltError passthrough, phase-level
 * honest close).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ResilienceError,
  classifyError,
  providerErrorFromResponse,
  type ChatResult,
} from '@secscan/redteam-llm-router'
import { coordinatorDirectiveOrClose } from '../src/phases/directive.js'
import { exploitPhase } from '../src/phases/exploit.js'
import { EventLog, readEvents } from '../src/events.js'
import type { EngagementEvent } from '../src/types.js'
import { HaltError, type Ctx } from '../src/context.js'

const FIXTURE_BODY =
  '{"error":{"code":"safety_blocked","message":"Request blocked by the safety system: the submitted content may violate policy."}}'

/** The §8 fixture: the real response builder + classifier + executor wrap, by hand. */
async function fixtureResilienceError(): Promise<ResilienceError> {
  const providerError = await providerErrorFromResponse(
    'meta',
    'Meta',
    new Response(FIXTURE_BODY, { status: 400 }),
  )
  const classified = classifyError(providerError)
  assert.equal(classified.reason, 'content_policy', 'fixture must classify content_policy after Q-HALT Item 2')
  return new ResilienceError(classified, 1, providerError)
}

let dir = ''
beforeEach(() => {
  dir = join(tmpdir(), `directive-failure-${process.pid}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A fake Ctx whose completion seam throws `err` on every call. */
function makeCtx(eventsDir: string, err: unknown): Ctx {
  const completeForRole = async (): Promise<ChatResult> => {
    throw err
  }
  return {
    actions: 0,
    consecutive5xx: 0,
    startedAt: Date.now(),
    hosts: ['shop.example.test'],
    config: {
      maxActions: 60,
      maxDurationMs: 60_000,
      maxExploitProbes: 10,
      dryRunAgents: false,
      localSandbox: false,
    },
    input: {
      target: 'https://shop.example.test',
      mode: 'red',
      objective: 'assess the shop',
      roe: { blackoutWindows: [] },
      fullBattery: false,
    },
    deps: { completeForRole },
    events: new EventLog(eventsDir, 'eng-directive-failure', {
      target: 'shop.example.test',
      mode: 'red',
      objective: 'test',
    }),
    coverage: new Set(),
    targetCoverage: new Map(),
    itemLedger: new Map(),
    registryHits: [],
    probesUsed: 0,
    opsecCooldown: new Set(),
    redirects: 0,
    liveFindings: [],
    killedLive: [],
    targetMap: [],
    safety: { killSwitchAborts: 0 },
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
  } as unknown as Ctx
}

function eventsOf(action: string): EngagementEvent[] {
  return readEvents(dir).filter(e => e.action === action)
}

describe('coordinatorDirectiveOrClose (Q-HALT Item 4)', () => {
  it('a safety-rejected directive call returns null and records directive_failed with the cause', async () => {
    const ctx = makeCtx(dir, await fixtureResilienceError())
    const out = await coordinatorDirectiveOrClose(ctx, 'decompose', 'fixture context')
    assert.equal(out, null)
    const failed = eventsOf('directive_failed')
    assert.equal(failed.length, 1, 'exactly one directive_failed event')
    assert.match(failed[0]?.result ?? '', /content_policy/)
    assert.match(failed[0]?.result ?? '', /safety system/)
  })

  it('a HaltError is rethrown untouched and records no directive_failed event', async () => {
    const halt = new HaltError('action cap reached')
    const ctx = makeCtx(dir, halt)
    await assert.rejects(coordinatorDirectiveOrClose(ctx, 'replan', 'fixture context'), (err: unknown) => err === halt)
    assert.equal(eventsOf('directive_failed').length, 0)
  })

  it('exploitPhase closes honestly when the decompose directive fails', async () => {
    const ctx = makeCtx(dir, await fixtureResilienceError())
    const summary = await exploitPhase(ctx, 'recon brief')
    assert.match(summary, /Coordinator directive failed \(decompose\); phase closed with completed work only\./)
    assert.equal(eventsOf('directive_failed').length, 1)
    assert.ok(eventsOf('battery_incomplete').length >= 1, 'battery recorded NOT COMPLETE')
    assert.equal(eventsOf('exploit_summary').length, 1, 'the phase still writes its closing summary')
  })
})
