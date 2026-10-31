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
