/**
 * Charter completion, live wiring (spec §2/§3): the production
 * completion agentLoop falls back to is chartered — charter first in
 * the assembled messages, the phase anchor carried in, refusals
 * classified and run through the fallback chain with the refused text
 * never entering the loop's context, and every incident in the audit
 * trail. Provider calls are seamed; no network is touched.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessage, ChatResult } from '@secscan/redteam-llm-router'
import { createCharteredComplete, charterEngagementFor } from '../src/charter-completion.js'
import type { Ctx } from '../src/context.js'

interface CapturedEvent { phase: string; actor: string; action: string; result: string }

function makeCtx(events: CapturedEvent[]): Ctx {
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
    events: { append: (e: CapturedEvent) => events.push(e) },
  } as unknown as Ctx
}

const ANCHOR_TEXT = [
  'engagement: example.com-4242 for Example Owner LLC',
  'scope: example.com',
  'objective: assess the external attack surface',
  'artifact: a falsification-ready finding',
].join('\n')

function result(text: string, toolCalls: ChatResult['toolCalls'] = []): ChatResult {
  return { text, toolCalls, provider: 'deepseek', model: 'deepseek-chat' }
}

function seams(over: {
  call?: (messages: ChatMessage[]) => Promise<ChatResult>
  fallbackText?: string
}) {
  const state = { primaryCalls: 0, fallbackCalls: 0, elicitations: 0 }
  return {
    state,
    seams: {
      elicitationCall: async () => {
        state.elicitations++
        return result(ANCHOR_TEXT)
      },
      call: async (_route: unknown, messages: ChatMessage[]) => {
        state.primaryCalls++
        return over.call ? over.call(messages) : result('working')
      },
      fallbackCall: async () => {
        state.fallbackCalls++
        return result(over.fallbackText ?? 'RECOVERED ARTIFACT')
      },
    },
  }
}

describe('charterEngagementFor', () => {
  it('fills the record from what the runner holds, honestly', () => {
    const eng = charterEngagementFor(makeCtx([]))
    assert.equal(eng.engagementId, 'example.com-4242')
    assert.equal(eng.owner, 'Example Owner LLC')
    assert.equal(eng.proofMethod, 'DNS TXT record')
    assert.equal(eng.inScope, 'example.com')
  })

  it('labels an unattested proof instead of inventing one', () => {
    const ctx = makeCtx([])
    ;(ctx as { verificationProof?: string }).verificationProof = undefined
    const eng = charterEngagementFor(ctx)
    assert.match(eng.proofMethod, /operator-attested/)
  })
})

describe('createCharteredComplete', () => {
  it('puts the charter first, the persona after it, and carries the anchor', async () => {
    const events: CapturedEvent[] = []
    const { seams: s, state } = seams({})
    const complete = createCharteredComplete(makeCtx(events), 'recon', s as never)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'PERSONA: recon specialist' },
      { role: 'user', content: 'map the surface' },
    ]
    const res = await complete('recon', messages, {})
    assert.equal(res.text, 'working')
    assert.equal(state.elicitations, 1)
    // The loop's own array now carries the assembled head: one system
    // message with the charter first, the persona after it, and the
    // phase anchor carried in — then the task.
    const head = messages[0].content
    const charterAt = head.indexOf('example.com-4242')
    const personaAt = head.indexOf('PERSONA: recon specialist')
    const anchorAt = head.indexOf('artifact: a falsification-ready finding')
    assert.ok(charterAt >= 0, 'charter (with the filled engagement id) leads')
    assert.ok(personaAt > charterAt, 'persona lands after the charter')
    assert.ok(anchorAt > charterAt, 'anchor is in context')
    assert.equal(messages[1].role, 'user')
    assert.ok(events.some(e => e.action === 'phase_anchor'))
  })

  it('elicits the anchor once per phase across loops', async () => {
    const events: CapturedEvent[] = []
    const { seams: s, state } = seams({})
    const ctx = makeCtx(events)
    const a = createCharteredComplete(ctx, 'exploit', s as never)
    const b = createCharteredComplete(ctx, 'exploit', s as never)
    await a('exploiter', [{ role: 'user', content: 'go' }], {})
    await b('exploiter', [{ role: 'user', content: 'go' }], {})
    assert.equal(state.elicitations, 1)
  })

  it('runs the fallback chain on a refusal and keeps the refused text out of context', async () => {
    const events: CapturedEvent[] = []
    const { seams: s, state } = seams({
      call: async () => result("I can't help with that request."),
    })
    const complete = createCharteredComplete(makeCtx(events), 'exploit', s as never)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'PERSONA: exploiter' },
      { role: 'user', content: 'build the payload' },
    ]
    const res = await complete('exploiter', messages, {})
    assert.equal(res.text, 'RECOVERED ARTIFACT')
    assert.ok(state.fallbackCalls >= 1)
    assert.ok(!messages.some(m => m.content.includes("can't help")), 'refusal text never enters the transcript')
    assert.ok(events.some(e => e.action === 'refusal_detected'))
    assert.ok(events.some(e => e.action === 'refusal_telemetry'))
  })

  it('ends the turn empty when every hop refuses', async () => {
    const events: CapturedEvent[] = []
    const { seams: s } = seams({
      call: async () => result("I can't help with that request."),
      fallbackText: "I can't help with that request.",
    })
    const complete = createCharteredComplete(makeCtx(events), 'exploit', s as never)
    const res = await complete('exploiter', [{ role: 'user', content: 'build the payload' }], {})
    assert.equal(res.text, '')
    assert.deepEqual(res.toolCalls, [])
    assert.ok(events.some(e => e.action === 'refusal_all_hops'))
  })

  it('never classifies a response that acts', async () => {
    const events: CapturedEvent[] = []
    const { seams: s, state } = seams({
      call: async () =>
        result("I can't help but notice the parameter reflects input.", [
          { id: 'c1', name: 'http_get', arguments: {} } as never,
        ]),
    })
    const complete = createCharteredComplete(makeCtx(events), 'exploit', s as never)
    const res = await complete('exploiter', [{ role: 'user', content: 'probe it' }], {})
    assert.equal(res.toolCalls.length, 1)
    assert.equal(state.fallbackCalls, 0)
    assert.ok(!events.some(e => e.action === 'refusal_detected'))
  })
})
