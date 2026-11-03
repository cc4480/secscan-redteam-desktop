/**
 * Q-STRUCT runner half (A1/A2/A4): the structured-output seam and its
 * first two adoptions.
 *
 * A1 — createCharteredComplete's options carry `responseFormat` through
 * to the provider call; absent = the historical unconstrained behavior.
 * A2 — the Challenger's falsification record and the Architect refine
 * ops are declared as json_schema constraints on the calls themselves,
 * validated by the router's own validateResponseFormat; each site's
 * hand parser/validator stays as the response-side check.
 * A3 — agentLoop's own completion calls carry a caller-supplied
 * responseFormat opt; the directive and plan phases (whose loop text is
 * parsed as JSON) adopt { type: 'json_object' } through it.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  validateResponseFormat,
  type ChatMessage,
  type ChatResult,
  type JsonSchemaTool,
  type ResponseFormat,
} from '@secscan/redteam-llm-router'
import { createCharteredComplete, type CharteredCallOptions } from '../src/charter-completion.js'
import { FALSIFICATION_FORMAT, parseFalsificationRecord } from '../src/exploit-cell/challenger.js'
import {
  completeGraphSubtask,
  ensureWorkGraph,
  graphSubtaskFor,
  startGraphSubtask,
  REFINE_FORMAT,
} from '../src/workgraph/wiring.js'
import { EventLog } from '../src/events.js'
import { agentLoop } from '../src/agents.js'
import { coordinatorDirective } from '../src/phases/directive.js'
import { planPhase } from '../src/phases/plan.js'
import { COMMAND_TOOLS } from '../src/tools.js'
import type { Ctx } from '../src/context.js'
import type { PlanStep } from '../src/types.js'

const FORMAT: ResponseFormat = { type: 'json_object' }

describe('A1 — the chartered seam carries responseFormat', () => {
  const ANCHOR_TEXT = [
    'engagement: example.com-4242 for Example Owner LLC',
    'scope: example.com',
    'objective: assess the external attack surface',
    'artifact: a falsification-ready finding',
  ].join('\n')

  function makeCtx(): Ctx {
    return {
      domain: 'example.com',
      startedAt: 4242,
      hosts: ['example.com'],
      verificationProof: 'DNS TXT record',
      input: {
        target: 'https://example.com',
        mode: 'red',
        objective: 'assess the external attack surface',
        client: 'Example Owner LLC',
        roe: {},
      },
      events: { append: () => {} },
    } as unknown as Ctx
  }

  function captureSeams(captured: { opts?: CharteredCallOptions }) {
    return {
      elicitationCall: async (): Promise<ChatResult> => ({ text: ANCHOR_TEXT, toolCalls: [], provider: 'deepseek', model: 'deepseek-chat' }),
      call: async (_route: unknown, _messages: ChatMessage[], opts: CharteredCallOptions): Promise<ChatResult> => {
        captured.opts = opts
        return { text: 'working', toolCalls: [], provider: 'deepseek', model: 'deepseek-chat' }
      },
    }
  }

  it('forwards the option to the provider call', async () => {
    const captured: { opts?: CharteredCallOptions } = {}
    const complete = createCharteredComplete(makeCtx(), 'recon', captureSeams(captured))
    await complete('recon', [{ role: 'user', content: 'hi' }], { responseFormat: FORMAT })
    assert.deepEqual(captured.opts?.responseFormat, FORMAT)
  })

  it('leaves the option absent when the caller passes none', async () => {
    const captured: { opts?: CharteredCallOptions } = {}
    const complete = createCharteredComplete(makeCtx(), 'recon', captureSeams(captured))
    await complete('recon', [{ role: 'user', content: 'hi' }], {})
    assert.equal(captured.opts?.responseFormat, undefined)
  })
})

describe('A2 — challenger falsification format', () => {
  it('validates under the router validateResponseFormat', () => {
    assert.doesNotThrow(() => validateResponseFormat(FALSIFICATION_FORMAT))
  })

  it('parseFalsificationRecord behavior is unchanged on fixtures', () => {
    const good = JSON.stringify({
      claim: 'endpoint reflects input unencoded',
      alternative: 'a WAF encodes it upstream',
      test: 'fresh request with a canary payload',
      evidence: 'receipt rcpt-1',
      verdict: 'stands',
    })
    const rec = parseFalsificationRecord(good)
    assert.ok(rec)
    assert.equal(rec.verdict, 'stands')
    assert.equal(parseFalsificationRecord(JSON.stringify({ claim: 'x', alternative: 'y', test: 'z', evidence: 'e', verdict: 'bogus' })), null)
    assert.equal(parseFalsificationRecord('no json here'), null)
  })
})

describe('A2 — architect refine format rides the deps-injected completion', () => {
  const STEPS: PlanStep[] = [
    { phase: 'recon', attackId: 'T1595', description: 'Map the surface' },
    { phase: 'exploit', attackId: 'T1190', description: 'Exploit public app' },
  ]
  let dir = ''
  beforeEach(() => {
    dir = join(tmpdir(), `wg-struct-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('validates under the router validateResponseFormat', () => {
    assert.doesNotThrow(() => validateResponseFormat(REFINE_FORMAT))
  })

  it('the refine call carries REFINE_FORMAT in its options', async () => {
    const events = new EventLog(dir, 'eng-struct', { target: 'shop.example.test', mode: 'red', objective: 'obj' })
    const captured: { opts?: unknown } = {}
    const ctx = {
      input: { target: 'shop.example.test', objective: 'obj', mode: 'red' },
      plan: { mode: 'red', objective: 'obj', adversaryProfile: 't', steps: STEPS },
      events,
      deps: {
        completeForRole: async (_role: unknown, messages: Array<{ content: string }>, opts?: unknown) => {
          const system = messages[0]?.content ?? ''
          if (system.includes('refining a penetration-test work-graph')) {
            captured.opts = opts
            return { text: '{}' }
          }
          return { text: '' }
        },
      },
    } as unknown as Ctx
    const flow = ensureWorkGraph(ctx)
    assert.ok(flow)
    const sub = graphSubtaskFor(ctx, { kind: 'probe', brief: 'exploit the app', attackId: 'T1190' })
    assert.ok(sub)
    startGraphSubtask(ctx, sub.id)
    await completeGraphSubtask(ctx, sub.id, 'confirmed finding', 1)
    assert.deepEqual((captured.opts as { responseFormat?: unknown })?.responseFormat, REFINE_FORMAT)
  })
})

describe('A3 — agentLoop forwards the opt; directive + plan adopt json_object', () => {
  let dir = ''
  beforeEach(() => {
    dir = join(tmpdir(), `struct-a3-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  type CallOpts = { responseFormat?: ResponseFormat; tools?: JsonSchemaTool[] }

  /** A loop-ready fake Ctx (reflector-test shape) whose completion seam
   * records the options of every call and replies with fixed text. */
  function makeCtx(captured: CallOpts[], reply: string): Ctx {
    const completeForRole = async (_role: unknown, _messages: unknown, opts?: CallOpts): Promise<ChatResult> => {
      captured.push(opts ?? {})
      return { text: reply, toolCalls: [], provider: 'fake', model: 'fake' }
    }
    return {
      actions: 0,
      consecutive5xx: 0,
      deniedStreak: 0,
      redirects: { 'plan→recon': 0, 'recon→exploit': 0, 'exploit→report': 0 },
      wallRedirects: 0,
      startedAt: Date.now(),
      hosts: ['shop.example.test'],
      domain: 'shop.example.test',
      verificationProof: 'DNS TXT record',
      config: { maxActions: 1000, maxDurationMs: 60_000, dryRunAgents: false },
      input: {
        target: 'https://shop.example.test',
        mode: 'red',
        objective: 'assess the shop',
        roe: { blackoutWindows: [], scope: ['shop.example.test'] },
        fullBattery: false,
      },
      deps: { completeForRole },
      events: new EventLog(dir, 'eng-struct-a3', { target: 'shop.example.test', mode: 'red', objective: 'assess the shop' }),
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

  it('agentLoop forwards the opt to the loop completion calls', async () => {
    const captured: CallOpts[] = []
    const ctx = makeCtx(captured, 'done')
    const text = await agentLoop(ctx, 'coordinator', 'plan', 'sys', 'user', [], 2, { responseFormat: FORMAT })
    assert.equal(text, 'done')
    assert.ok(captured.length >= 1)
    for (const opts of captured) assert.deepEqual(opts.responseFormat, FORMAT)
  })

  it('agentLoop leaves the opt absent when the caller passes none', async () => {
    const captured: CallOpts[] = []
    const ctx = makeCtx(captured, 'done')
    await agentLoop(ctx, 'coordinator', 'plan', 'sys', 'user', [], 2)
    assert.ok(captured.length >= 1)
    for (const opts of captured) assert.equal(opts.responseFormat, undefined)
  })

  it('coordinatorDirective runs its loop under json_object', async () => {
    const captured: CallOpts[] = []
    const ctx = makeCtx(captured, JSON.stringify({ tasks: [], finish: true, note: 'fixture' }))
    const out = await coordinatorDirective(ctx, 'decompose', 'fixture context')
    assert.equal(out.finish, true)
    assert.ok(captured.length >= 1)
    for (const opts of captured) assert.deepEqual(opts.responseFormat, { type: 'json_object' })
  })

  it('planPhase runs its loop under json_object', async () => {
    const captured: CallOpts[] = []
    const ctx = makeCtx(captured, JSON.stringify({ adversaryProfile: 'fixture-profile', steps: [] }))
    await planPhase(ctx)
    assert.equal(ctx.plan?.adversaryProfile, 'fixture-profile')
    assert.ok(captured.length >= 1)
    for (const opts of captured) assert.deepEqual(opts.responseFormat, { type: 'json_object' })
  })

  it('planPhase offers the coordinator the full tool catalog', async () => {
    const captured: CallOpts[] = []
    const ctx = makeCtx(captured, JSON.stringify({ adversaryProfile: 'fixture-profile', steps: [] }))
    await planPhase(ctx)
    assert.equal(ctx.plan?.adversaryProfile, 'fixture-profile')
    assert.ok(captured.length >= 1)
    // Universal access: the plan loop's completion calls carry the same
    // catalog the directive and sign-off loops carry (COMMAND_TOOLS is
    // the FULL_TOOLS union under its coordinator name — tools/compose.ts).
    // Before the fix this call site passed an empty tool set.
    for (const opts of captured) assert.deepEqual(opts.tools, COMMAND_TOOLS)
    assert.ok(COMMAND_TOOLS.length > 0)
  })
})
