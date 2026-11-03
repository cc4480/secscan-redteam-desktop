/**
 * Fleet audit M1 — the coder (TANK) seat is wired, not decorative.
 *
 * Before this slice the coder role existed only in fleet assembly's maps
 * (role → tank soul, role → exploit-coding-toolbuilding skill) and no
 * phase ever requested work from it. These tests pin the wiring:
 *  (a) a coder request is built via buildFleetPrompt with the 'coder'
 *      role — the captured system prompt carries the TANK soul and the
 *      coding skill body, inside the fleet assembly order;
 *  (b) the exploit path (runTask) invokes the coder seat when a probe
 *      task declares a custom-code need (codeNeed) and the returned
 *      artifact is consumed — it lands in the exploiter's task prompt
 *      and on the TaskResult;
 *  (c) a task without a code need never calls the coder seat;
 *  (d) validateTasks keeps a codeNeed on a probe task and drops it on a
 *      recon task (recon never crafts payloads — the batteryItem rule).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatMessage, ChatResult } from '@secscan/redteam-llm-router'
import { requestCoderArtifact } from '../src/exploit-cell/coder.js'
import { runTask, validateTasks, type TaskDef } from '../src/phases/tasks.js'
import { EventLog } from '../src/events.js'
import type { Ctx } from '../src/context.js'
import type { EngagementEvent } from '../src/types.js'

const ARTIFACT = 'TANK-ARTIFACT-7Q2X9: double-url-encoded union-select payload'
const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
const NEED = 'a double-URL-encoded UNION SELECT payload for the search parameter'

type CompleteFn = (role: string, messages: ChatMessage[], opts: unknown) => Promise<ChatResult>

const isCoderCall = (messages: ChatMessage[]): boolean =>
  (messages[0]?.content ?? '').includes('# TANK — Coder / Tool-Builder')

/** A ctx whose authorize phase has stamped its record, so promptCtx
 *  carries the fleet input and buildFleetPrompt actually assembles. */
function stampedCtx(completeForRole: CompleteFn, events: { append: (e: unknown) => void; engagementId: string }): Ctx {
  return {
    domain: 'example.com',
    hosts: ['app.example.com', 'example.com'],
    verifiedScope: ['app.example.com', 'example.com'],
    verificationProof: 'DNS TXT ownership proof (fixture)',
    verifiedAt: '2026-11-01T00:00:00.000Z',
    events,
    config: { localSandbox: false, testMode: false },
    deps: { completeForRole },
    input: {
      target: 'https://example.com',
      mode: 'red',
      objective: 'assess the fixture attack surface',
      client: 'Fixture Owner LLC',
      operatorName: 'Fixture Operator',
      roe: { scope: ['app.example.com', 'example.com'] },
    },
  } as unknown as Ctx
}

describe('coder seat (TANK) — requestCoderArtifact', () => {
  it('(a) builds the coder request via buildFleetPrompt with the coder role', async () => {
    const captured: ChatMessage[][] = []
    const completeForRole: CompleteFn = async (_role, messages) => {
      captured.push(messages)
      return { text: ARTIFACT, toolCalls: [], provider: 'fake', model: 'fake', usage: USAGE }
    }
    const appended: unknown[] = []
    const ctx = stampedCtx(completeForRole, { engagementId: 'eng-coder-1', append: (e) => appended.push(e) })
    const artifact = await requestCoderArtifact(ctx, {
      brief: 'test the search parameter for SQL injection',
      codeNeed: NEED,
      attackId: 'T1190',
      category: 'validation',
    })
    assert.equal(artifact.text, ARTIFACT)
    assert.equal(captured.length, 1, 'exactly one coder completion')
    const system = captured[0]![0]!.content
    // Fleet assembly order + coder markers: master opens, TANK soul and the
    // coding skill body are present, the seat delta names the need.
    assert.equal(system.indexOf('<identity>'), 0, 'the fleet master block opens the prompt')
    assert.ok(system.includes('# TANK — Coder / Tool-Builder'), 'the TANK soul is in the prompt')
    assert.ok(system.includes('<skill_content name="exploit-coding-toolbuilding">'), 'the coder Layer-2 skill body is attached')
    assert.ok(system.includes('<verified_engagement>'), 'the verified engagement injection is present')
    assert.ok(system.includes('# Coder — TANK, the one who builds the program'), 'the coder seat delta is present')
    assert.ok(!system.includes('<skill_content name="webapp-exploit">'), "no other seat's Layer-2 body is attached")
    assert.ok((captured[0]![1]!.content ?? '').includes(NEED), 'the user turn carries the declared need')
    assert.ok(
      appended.some((e) => (e as { action?: string }).action === 'coder_artifact'),
      'the artifact generation is in the audit trail',
    )
  })

  it('(a2) an empty coder reply is an error, never an empty artifact', async () => {
    const completeForRole: CompleteFn = async () => ({ text: '  ', toolCalls: [], provider: 'fake', model: 'fake', usage: USAGE })
    const ctx = stampedCtx(completeForRole, { engagementId: 'eng-coder-2', append: () => {} })
    await assert.rejects(() => requestCoderArtifact(ctx, { brief: 'b', codeNeed: NEED }), /returned no artifact/)
  })
})

describe('coder seat (TANK) — the exploit path (runTask)', () => {
  function loopCtx(dir: string, completeForRole: CompleteFn): Ctx {
    const base = stampedCtx(completeForRole, new EventLog(dir, 'eng-coder-task', { target: 'shop.example.test', mode: 'red', objective: 'test' }) as never)
    return {
      ...base,
      actions: 0,
      consecutive5xx: 0,
      deniedStreak: 0,
      redirects: { 'plan→recon': 0, 'recon→exploit': 0, 'exploit→report': 0 },
      wallRedirects: 0,
      probesUsed: 0,
      startedAt: Date.now(),
      config: { maxActions: 100, maxDurationMs: 60_000, localSandbox: false, testMode: false },
      input: {
        mode: 'red',
        objective: 'test',
        target: 'https://shop.example.test',
        client: 'Fixture Owner LLC',
        operatorName: 'Fixture Operator',
        roe: { blackoutWindows: [], scope: ['shop.example.test'] },
      },
      deps: {
        completeForRole,
        bridgeClient: { available: async () => false, listTools: async () => [], call: async () => '' },
      },
      hosts: ['shop.example.test'],
      domain: 'shop.example.test',
      plan: null,
      targetMap: [],
      liveFindings: [],
      killedLive: [],
      peerKilledLive: [],
      peerDeferredLive: [],
      registryHits: [],
      fingerprint: { stack: [], appType: 'unknown' },
      coverage: new Set(),
      targetCoverage: new Map(),
      itemLedger: new Map(),
      opsecCooldown: new Set<string>(),
      safety: { limiter: { acquire: async () => {} } },
      tier: { current: 2, chainSteps: new Map<string, number>() },
    } as unknown as Ctx
  }

  function scriptedModel(state: { coderCalls: number; exploiterUserTurns: string[] }): CompleteFn {
    return async (_role, messages) => {
      if (isCoderCall(messages)) {
        state.coderCalls++
        return { text: ARTIFACT, toolCalls: [], provider: 'fake', model: 'fake', usage: USAGE }
      }
      state.exploiterUserTurns.push(messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n'))
      return { text: 'TRIED: coder payload / OBSERVED: 200 / VERDICT: killed', toolCalls: [], provider: 'fake', model: 'fake', usage: USAGE }
    }
  }

  const probeTask = (over: Partial<TaskDef> = {}): TaskDef => ({
    id: 'task-coder-1',
    kind: 'probe',
    brief: 'test the search parameter for SQL injection',
    attackId: 'T1190',
    category: 'validation',
    maxTurns: 4,
    ...over,
  })

  it('(b) invokes the coder seat when a task declares a code need and consumes the artifact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-coder-'))
    try {
      const state = { coderCalls: 0, exploiterUserTurns: [] as string[] }
      const ctx = loopCtx(dir, scriptedModel(state))
      const result = await runTask(ctx, probeTask({ codeNeed: NEED }))
      assert.equal(state.coderCalls, 1, 'the coder seat was called exactly once')
      assert.equal(result.coderArtifact, ARTIFACT, 'the artifact is on the TaskResult')
      assert.ok(
        state.exploiterUserTurns.some((t) => t.includes('CODER ARTIFACT') && t.includes(ARTIFACT)),
        "the exploiter's task prompt carries the coder artifact for execution",
      )
      const events = readFileSync(join(dir, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as EngagementEvent)
      assert.ok(events.some((e) => e.action === 'coder_artifact'), 'coder_artifact event recorded')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('(c) never calls the coder seat for a task without a code need', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-coder-none-'))
    try {
      const state = { coderCalls: 0, exploiterUserTurns: [] as string[] }
      const ctx = loopCtx(dir, scriptedModel(state))
      const result = await runTask(ctx, probeTask())
      assert.equal(state.coderCalls, 0, 'no code need, no coder call')
      assert.equal(result.coderArtifact, undefined)
      assert.ok(!state.exploiterUserTurns.some((t) => t.includes('CODER ARTIFACT')), 'no artifact block is injected')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('coder seat (TANK) — codeNeed validation', () => {
  function stubCtx(): Ctx {
    return { events: { append: () => {} } } as unknown as Ctx
  }

  it('(d) keeps a declared codeNeed on a probe task', () => {
    const tasks = validateTasks(
      stubCtx(),
      [{ kind: 'probe', brief: 'test for SQLi', category: 'validation', codeNeed: NEED, maxTurns: 6 }],
      4,
    )
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.codeNeed, NEED)
  })

  it('(d) drops a codeNeed from a recon task — recon never crafts payloads', () => {
    const tasks = validateTasks(
      stubCtx(),
      [{ kind: 'recon', brief: 'map the surface', codeNeed: NEED, maxTurns: 6 }],
      4,
    )
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.codeNeed, undefined)
  })
})
