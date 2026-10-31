/**
 * Reflector tests (runner corrections Item 6, 2026-10-31).
 *
 * The reflector is a bounded reflection step: a stuck batch may spend
 * one tool-less model call whose steering becomes the next user
 * message. Cap 3 per agentLoop invocation, exhaustion announced once,
 * never a halt. Unit tests run the Reflector against a captured event
 * log; integration tests drive agentLoop with a scripted model and pin
 * the reflect-before-redirect ordering in the real event stream.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Reflector, parseReflection, reflectionTrigger, type BatchOutcome } from '../src/reflector.js'
import { resolveConfig } from '../src/phases/config.js'
import { agentLoop } from '../src/agents.js'
import { EventLog } from '../src/events.js'
import type { Ctx } from '../src/context.js'
import type { EngagementEvent, EngagementPhase } from '../src/types.js'

const PHASE = 'exploit' as EngagementPhase
const STUCK: BatchOutcome = { calls: 2, successes: 0, denied: 2, deniedStreak: 2 }
const WALL: BatchOutcome = { calls: 4, successes: 0, denied: 4, deniedStreak: 4 }
const PROGRESS: BatchOutcome = { calls: 2, successes: 1, denied: 1, deniedStreak: 0 }

function fakeCtx() {
  const appended: Array<{ action: string; result: string }> = []
  const ctx = {
    events: {
      append: (e: { action: string; result: string }) => {
        appended.push({ action: e.action, result: e.result })
      },
    },
  } as unknown as Ctx
  return { ctx, appended }
}

const JSON_ANSWER = JSON.stringify({ verdict: 'change_approach', steering: 'Stop guessing paths; fingerprint the stack first.' })

describe('reflector trigger', () => {
  it('fires on a zero-progress batch and on a wall, silent on progress and on empty batches', () => {
    assert.equal(reflectionTrigger(STUCK), 'zero_progress')
    assert.equal(reflectionTrigger(WALL), 'denied_streak')
    assert.equal(reflectionTrigger(PROGRESS), null)
    assert.equal(reflectionTrigger({ calls: 0, successes: 0, denied: 0, deniedStreak: 0 }), null)
    // A batch that progressed but ended in a wall still reflects first
    // (the redirect it delays is the expensive intervention).
    assert.equal(reflectionTrigger({ calls: 6, successes: 2, denied: 4, deniedStreak: 4 }), 'denied_streak')
  })
})

describe('reflector cap', () => {
  it('spends at most 3 reflections, then announces exhaustion exactly once and never halts', async () => {
    const { ctx, appended } = fakeCtx()
    const reflector = new Reflector(ctx, PHASE, 3)
    let asks = 0
    const ask = async () => {
      asks++
      return JSON_ANSWER
    }
    for (let i = 0; i < 3; i++) {
      const r = await reflector.maybeReflect('exploiter', STUCK, ask)
      assert.ok(r, `reflection ${i + 1} spent`)
      assert.equal(r.count, i + 1)
      assert.equal(r.verdict, 'change_approach')
      assert.match(r.steering, /fingerprint the stack/)
    }
    assert.equal(await reflector.maybeReflect('exploiter', STUCK, ask), null)
    assert.equal(await reflector.maybeReflect('exploiter', STUCK, ask), null)
    assert.equal(asks, 3, 'no model call once the cap is spent')
    const spent = appended.filter(e => e.action === 'reflector')
    assert.equal(spent.length, 3)
    assert.match(spent[0]!.result, /reflector \(1\/3\) trigger=zero_progress verdict=change_approach/)
    assert.equal(appended.filter(e => e.action === 'reflector_exhausted').length, 1, 'exhaustion announced exactly once')
  })

  it('cap 0 disables reflection entirely', async () => {
    const { ctx, appended } = fakeCtx()
    const reflector = new Reflector(ctx, PHASE, 0)
    let asks = 0
    const r = await reflector.maybeReflect('exploiter', WALL, async () => {
      asks++
      return JSON_ANSWER
    })
    assert.equal(r, null)
    assert.equal(asks, 0)
    assert.deepEqual(appended, [])
  })

  it('stays silent on a progress batch (no ask, no event)', async () => {
    const { ctx, appended } = fakeCtx()
    const reflector = new Reflector(ctx, PHASE, 3)
    const r = await reflector.maybeReflect('exploiter', PROGRESS, async () => {
      throw new Error('must not be called')
    })
    assert.equal(r, null)
    assert.deepEqual(appended, [])
  })

  it('a failed reflection call is spent and logged, and returns null', async () => {
    const { ctx, appended } = fakeCtx()
    const reflector = new Reflector(ctx, PHASE, 3)
    const r = await reflector.maybeReflect('exploiter', STUCK, async () => {
      throw new Error('provider down')
    })
    assert.equal(r, null)
    assert.equal(reflector.reflectionsSpent, 1)
    assert.equal(appended.length, 1)
    assert.match(appended[0]!.result, /verdict=error/)
    assert.match(appended[0]!.result, /provider down/)
  })
})

describe('reflection answer parsing', () => {
  it('keeps a structured verdict and steering', () => {
    assert.deepEqual(parseReflection(JSON_ANSWER), {
      verdict: 'change_approach',
      steering: 'Stop guessing paths; fingerprint the stack first.',
    })
  })

  it('carries unstructured text verbatim as steering', () => {
    const p = parseReflection('Just try the API docs surface instead.')
    assert.equal(p.verdict, 'unparsed')
    assert.equal(p.steering, 'Just try the API docs surface instead.')
  })
})

describe('reflector config resolution', () => {
  const ENV_PIN = {
    SECSCAN_MCP_TOKEN: 'test-token',
    DEEPSEEK_API_KEY: 'test-key',
    REDTEAM_OPERATOR: 'test-operator',
    REDTEAM_ENV: 'staging',
  } as unknown as NodeJS.ProcessEnv

  it('defaults to 3', () => {
    assert.equal(resolveConfig(ENV_PIN, {}).reflectorCap, 3)
  })

  it('parses the env override', () => {
    const env = { ...ENV_PIN, REDTEAM_REFLECTOR_CAP: '5' } as NodeJS.ProcessEnv
    assert.equal(resolveConfig(env, {}).reflectorCap, 5)
  })

  it('explicit opts beat env', () => {
    const env = { ...ENV_PIN, REDTEAM_REFLECTOR_CAP: '5' } as NodeJS.ProcessEnv
    assert.equal(resolveConfig(env, { reflectorCap: 1 }).reflectorCap, 1)
  })

  it('fails loud on a non-positive env value', () => {
    const env = { ...ENV_PIN, REDTEAM_REFLECTOR_CAP: '0' } as NodeJS.ProcessEnv
    assert.throws(() => resolveConfig(env, {}), /REDTEAM_REFLECTOR_CAP/)
    const env2 = { ...ENV_PIN, REDTEAM_REFLECTOR_CAP: 'abc' } as NodeJS.ProcessEnv
    assert.throws(() => resolveConfig(env2, {}), /REDTEAM_REFLECTOR_CAP/)
  })
})

// ---------------------------------------------------------------------------
// Loop integration (scripted model, real event log — runner-integrity shape)
// ---------------------------------------------------------------------------

type CompleteFn = (role: string, messages: unknown, opts: unknown) => Promise<unknown>

function loopCtx(dir: string, completeForRole: CompleteFn): Ctx {
  return {
    actions: 0,
    consecutive5xx: 0,
    deniedStreak: 0,
    redirects: 0,
    startedAt: Date.now(),
    config: { maxActions: 1000, maxDurationMs: 60_000 },
    input: {
      mode: 'red',
      objective: 'test',
      target: 'shop.example.test',
      roe: { blackoutWindows: [], scope: ['shop.example.test'] },
    },
    deps: { completeForRole },
    events: new EventLog(dir, 'eng-reflector', { target: 'shop.example.test', mode: 'red', objective: 'test' }),
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
    safety: { killSwitchAborts: 0 },
    tier: { current: 0, chainSteps: new Map<string, number>() },
    hosts: ['shop.example.test'],
    domain: 'shop.example.test',
    plan: null,
    targetMap: [],
    liveFindings: [],
    killedLive: [],
    registryHits: [],
    fingerprint: { stack: [], appType: 'unknown' },
    coverage: new Set(),
    targetCoverage: new Map(),
    itemLedger: new Map(),
    opsecCooldown: new Set<string>(),
  } as unknown as Ctx
}

function readEvents(dir: string): EngagementEvent[] {
  return readFileSync(join(dir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as EngagementEvent)
}

const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
const idleTurn = { text: 'done', usage: USAGE }

function deniedBatch(n: number) {
  return {
    text: '',
    toolCalls: Array.from({ length: n }, (_, i) => ({ id: `c-${Date.now()}-${i}-${Math.random()}`, name: 'no_such_tool', arguments: {} })),
    usage: USAGE,
  }
}

function messageTexts(messages: unknown): string[] {
  return (messages as Array<{ content?: unknown }>).map(m => (typeof m.content === 'string' ? m.content : ''))
}

describe('reflector in agentLoop', () => {
  it('a stuck batch spends one reflection and the steering reaches the next model call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'refl-loop-'))
    try {
      let sawSteering = false
      const model: CompleteFn = async (_role, messages) => {
        const texts = messageTexts(messages)
        if (texts.some(t => t.startsWith('REFLECTION — you are'))) {
          return { text: JSON_ANSWER, usage: USAGE }
        }
        if (texts.some(t => t.startsWith('REFLECTION (1/3)'))) sawSteering = true
        // First main call: a denied batch. After steering arrives: idle.
        return sawSteering || texts.some(t => t.startsWith('REFLECTION (1/3)')) ? idleTurn : deniedBatch(2)
      }
      const ctx = loopCtx(dir, model)
      await agentLoop(ctx, 'exploiter', 'exploit', 's', 'u', [], 6, {})
      const evs = readEvents(dir)
      const reflections = evs.filter(e => e.action === 'reflector')
      assert.equal(reflections.length, 1, 'exactly one reflection spent')
      assert.match(reflections[0]!.result, /trigger=zero_progress verdict=change_approach/)
      assert.ok(sawSteering, 'the steering message was model-visible in the next call')
      assert.equal(evs.some(e => e.action === 'redirect_rerecon'), false, 'no redirect on a sub-wall batch')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reflects before redirecting, never both on one batch, redirect fires once reflections are spent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'refl-wall-'))
    try {
      const model: CompleteFn = async (_role, messages) => {
        const texts = messageTexts(messages)
        if (texts.some(t => t.startsWith('REFLECTION — you are'))) {
          return { text: JSON_ANSWER, usage: USAGE }
        }
        if (texts.some(t => t.includes('COMMANDER REDIRECT — focused re-recon'))) return idleTurn
        if (texts.some(t => t.startsWith('COMMANDER REDIRECT — re-recon complete'))) return idleTurn
        return deniedBatch(4)
      }
      const ctx = loopCtx(dir, model)
      await agentLoop(ctx, 'exploiter', 'exploit', 's', 'u', [], 12, {})
      const evs = readEvents(dir)
      const reflections = evs.filter(e => e.action === 'reflector')
      assert.equal(reflections.length, 3, 'three reflections spent across three wall batches')
      assert.ok(reflections.every(e => /trigger=denied_streak/.test(e.result)), 'wall batches reflect on the denied-streak trigger')
      const exhausted = evs.filter(e => e.action === 'reflector_exhausted')
      assert.equal(exhausted.length, 1, 'exhaustion announced once')
      const redirects = evs.filter(e => e.action === 'redirect_rerecon')
      assert.equal(redirects.length, 1, 'redirect fires only after reflections are spent')
      assert.ok(
        evs.indexOf(redirects[0]!) > evs.indexOf(exhausted[0]!),
        'redirect follows exhaustion in the event stream — never the same batch as a reflection',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('with reflection disabled, the exploit-phase redirect still fires under its own rules', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'refl-off-'))
    try {
      const model: CompleteFn = async (_role, messages) => {
        const texts = messageTexts(messages)
        if (texts.some(t => t.startsWith('REFLECTION — you are'))) {
          throw new Error('reflection must not be attempted when disabled')
        }
        if (texts.some(t => t.includes('COMMANDER REDIRECT — focused re-recon'))) return idleTurn
        if (texts.some(t => t.startsWith('COMMANDER REDIRECT — re-recon complete'))) return idleTurn
        return deniedBatch(4)
      }
      const ctx = loopCtx(dir, model)
      await agentLoop(ctx, 'exploiter', 'exploit', 's', 'u', [], 12, { reflectorCap: 0 })
      const evs = readEvents(dir)
      assert.equal(evs.some(e => e.action === 'reflector'), false)
      assert.equal(evs.filter(e => e.action === 'redirect_rerecon').length, 1, 'redirect fires on the first wall batch')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
