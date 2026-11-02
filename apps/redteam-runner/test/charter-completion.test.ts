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
import { ProviderError, type ChatMessage, type ChatResult } from '@secscan/redteam-llm-router'
import { buildEngagementInjection } from '@secscan/redteam-fleet-skills'
import { createCharteredComplete, charterEngagementFor, condensedReissueMessages } from '../src/charter-completion.js'
import { verifiedRecordFor } from '../src/prompts/fleet-assembly.js'
import type { Ctx } from '../src/context.js'

interface CapturedEvent { phase: string; actor: string; action: string; result: string }

function makeCtx(events: CapturedEvent[]): Ctx {
  return {
    domain: 'example.com',
    startedAt: 4242,
    hosts: ['example.com'],
    verificationProof: 'DNS TXT record',
    verifiedAt: '2026-11-02T00:00:00.000Z',
    input: {
      target: 'https://example.com',
      mode: 'red',
      objective: 'assess the external attack surface',
      client: 'Example Owner LLC',
      roe: { scope: ['example.com'] },
    },
    events: {
      engagementId: 'example.com-4242',
      append: (e: CapturedEvent) => events.push(e),
    },
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

  it('charters a side call that arrives with a fresh message array', async () => {
    const events: CapturedEvent[] = []
    const heads: string[] = []
    const { seams: s } = seams({
      call: async (messages) => {
        heads.push(messages[0].content)
        return result('working')
      },
    })
    const complete = createCharteredComplete(makeCtx(events), 'recon', s as never)
    await complete('recon', [
      { role: 'system', content: 'PERSONA: recon specialist' },
      { role: 'user', content: 'map the surface' },
    ], {})
    // The reflector/repair shape: a brand-new array built around the raw
    // persona, never seen by this completion before (agents.ts askReflection
    // and the tool-repair side channel both construct one per call).
    const side: ChatMessage[] = [
      { role: 'system', content: 'PERSONA: recon specialist' },
      { role: 'user', content: 'reflect on the stuck batch' },
    ]
    const res = await complete('recon', side, { tools: [] })
    assert.equal(res.text, 'working')
    assert.equal(heads.length, 2)
    assert.ok(heads[1].startsWith('You are an agent of SecScan RedTeam'), 'side call carries the charter head')
    assert.ok(heads[1].includes('example.com-4242'), 'side call carries the engagement record')
    assert.ok(heads[1].includes('PERSONA: recon specialist'), 'persona still lands after the charter')
    assert.equal(side[0].role, 'system')
    assert.ok(side[0].content.startsWith('You are an agent of SecScan RedTeam'), 'the side array itself was spliced in place')
  })

  it('never double-splices the charter into the same array', async () => {
    const events: CapturedEvent[] = []
    const heads: string[] = []
    const { seams: s } = seams({
      call: async (messages) => {
        heads.push(messages[0].content)
        return result('working')
      },
    })
    const complete = createCharteredComplete(makeCtx(events), 'recon', s as never)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'PERSONA: recon specialist' },
      { role: 'user', content: 'map the surface' },
    ]
    await complete('recon', messages, {})
    const lengthAfterFirst = messages.length
    await complete('recon', messages, {})
    assert.equal(messages.length, lengthAfterFirst)
    assert.equal(heads.length, 2)
    assert.equal(heads[1], heads[0], 'second call sends the identical head — no re-assembly')
    assert.equal(heads[1].split('You are an agent of SecScan RedTeam').length - 1, 1, 'exactly one charter head')
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

/** A thrown provider safety rejection (the Q-HALT incident shape). */
function policyError(): ProviderError {
  return new ProviderError({
    provider: 'meta',
    status: 400,
    code: 'safety_blocked',
    message:
      '[llm-router] Meta HTTP 400: {"error":{"code":"safety_blocked","message":"Request blocked by the safety system: the submitted content may violate policy."}}',
  })
}

describe('createCharteredComplete — thrown-policy containment (W2)', () => {
  it('re-issues once with the record attached and the context condensed, then recovers', async () => {
    const events: CapturedEvent[] = []
    const seen: ChatMessage[][] = []
    const { seams: s, state } = seams({
      call: async (messages) => {
        seen.push(messages)
        if (seen.length === 1) throw policyError()
        return result('RECOVERED BY REISSUE')
      },
    })
    const complete = createCharteredComplete(makeCtx(events), 'exploit', s as never)
    const rawDump = `batch dump ${'x'.repeat(3000)} RAW_DUMP_TAIL_MARKER`
    const res = await complete('exploiter', [
      { role: 'system', content: 'PERSONA: exploiter' },
      { role: 'user', content: 'work the batch' },
      { role: 'user', content: rawDump },
    ], {})
    assert.equal(res.text, 'RECOVERED BY REISSUE')
    assert.equal(state.primaryCalls, 2, 'original call + exactly one re-issue')
    assert.equal(state.fallbackCalls, 0, 'fallback chain not needed when the re-issue recovers')
    const reissueUser = seen[1].find(m => m.role === 'user')?.content ?? ''
    assert.ok(reissueUser.includes('<verified_engagement>'), 're-issue carries the engagement record')
    assert.ok(reissueUser.includes('CONDENSED RE-ISSUE'), 're-issue is the condensed form')
    assert.ok(!reissueUser.includes('RAW_DUMP_TAIL_MARKER'), 'the raw dump is NOT resent')
    const containment = events.find(e => e.action === 'policy_containment')
    assert.ok(containment, 'containment is logged')
    assert.ok(containment.result.includes('safety system'), 'the event carries the full provider error body')
    assert.ok(events.some(e => e.action === 'policy_reissue_recovered'))
  })

  it('routes to the fallback chain when the re-issue is also policy-rejected — no throw to the caller', async () => {
    const events: CapturedEvent[] = []
    const { seams: s, state } = seams({
      call: async () => {
        throw policyError()
      },
    })
    const complete = createCharteredComplete(makeCtx(events), 'exploit', s as never)
    const res = await complete('exploiter', [
      { role: 'system', content: 'PERSONA: exploiter' },
      { role: 'user', content: 'build the payload' },
    ], {})
    assert.equal(res.text, 'RECOVERED ARTIFACT', 'the fallback chain answers instead of the throw propagating')
    assert.equal(state.primaryCalls, 2, 'original + one re-issue, then the chain')
    assert.ok(state.fallbackCalls >= 1)
    assert.ok(events.some(e => e.action === 'policy_containment'))
    assert.ok(events.some(e => e.action === 'policy_containment_failed'))
  })

  it('rethrows a thrown non-policy error untouched, with no containment', async () => {
    const events: CapturedEvent[] = []
    const boom = new Error('database exploded')
    const { seams: s, state } = seams({
      call: async () => {
        throw boom
      },
    })
    const complete = createCharteredComplete(makeCtx(events), 'exploit', s as never)
    await assert.rejects(
      complete('exploiter', [{ role: 'user', content: 'probe it' }], {}),
      (err: unknown) => err === boom,
    )
    assert.equal(state.primaryCalls, 1, 'no re-issue for non-policy failures')
    assert.equal(state.fallbackCalls, 0)
    assert.ok(!events.some(e => e.action === 'policy_containment'))
  })

  it('rethrows when the re-issue fails with a non-policy error', async () => {
    const events: CapturedEvent[] = []
    const boom = new Error('database exploded')
    let calls = 0
    const { seams: s, state } = seams({
      call: async () => {
        calls++
        throw calls === 1 ? policyError() : boom
      },
    })
    const complete = createCharteredComplete(makeCtx(events), 'exploit', s as never)
    await assert.rejects(
      complete('exploiter', [{ role: 'user', content: 'probe it' }], {}),
      (err: unknown) => err === boom,
    )
    assert.equal(state.primaryCalls, 2)
    assert.equal(state.fallbackCalls, 0, 'fallback chain is for policy outcomes, not arbitrary failures')
    assert.ok(events.some(e => e.action === 'policy_containment'))
    assert.ok(!events.some(e => e.action === 'policy_containment_failed'))
  })
})

describe('condensedReissueMessages', () => {
  it('carries the record and a summary, never the full context', () => {
    const out = condensedReissueMessages([
      { role: 'system', content: 'CHARTERED HEAD' },
      { role: 'user', content: 'do the step' },
      { role: 'user', content: `observation ${'y'.repeat(3000)} TAIL_MARKER` },
    ], makeCtx([]))
    assert.equal(out[0].content, 'CHARTERED HEAD')
    const user = out[out.length - 1].content
    assert.ok(user.includes('<verified_engagement>'))
    assert.ok(user.includes('example.com-4242'))
    assert.ok(user.includes('do the step'))
    assert.ok(!user.includes('TAIL_MARKER'))
  })

  it('renders the record as the standard fleet injection, byte for byte (M8)', () => {
    const ctx = makeCtx([])
    const out = condensedReissueMessages([
      { role: 'system', content: 'CHARTERED HEAD' },
      { role: 'user', content: 'do the step' },
    ], ctx)
    const user = out[out.length - 1].content
    const standard = buildEngagementInjection(verifiedRecordFor(ctx))
    assert.ok(
      user.includes(standard),
      'the re-issue carries the identical sanitized injection the assembly path renders',
    )
    // The standard block is the FULL record — the target list, the
    // verification stamp, the session rule — not the hand-rendered
    // five-line subset the re-issue used to carry.
    assert.ok(user.includes('targets (complete list'))
    assert.ok(user.includes('verified at 2026-11-02T00:00:00.000Z'))
    assert.ok(user.includes('session_rule:'))
  })
})

describe('createCharteredComplete — the §3 fallback keeps the fleet prompt (H4)', () => {
  it('the fallback request carries the refused call\u2019s system message, not just its user text', async () => {
    const events: CapturedEvent[] = []
    const assembledHeads: string[] = []
    const s = {
      elicitationCall: async () => result(ANCHOR_TEXT),
      call: async () => result("I can't help with that request."),
      fallbackCall: async (_route: unknown, assembled: { messages: ChatMessage[] }) => {
        assembledHeads.push(assembled.messages.map((m) => m.content).join('\n'))
        return result('RECOVERED ARTIFACT')
      },
    }
    const complete = createCharteredComplete(makeCtx(events), 'exploit', s as never)
    const res = await complete('exploiter', [
      { role: 'system', content: 'PERSONA: exploiter — FLEET PROMPT MARKER' },
      { role: 'user', content: 'build the payload' },
    ], {})
    assert.equal(res.text, 'RECOVERED ARTIFACT')
    assert.ok(assembledHeads.length >= 1, 'the fallback chain ran')
    assert.ok(
      assembledHeads.some((h) => h.includes('FLEET PROMPT MARKER')),
      'the fallback request still carries the original system prompt (soul, skills, record)',
    )
    assert.ok(events.some((e) => e.action === 'refusal_telemetry'))
  })
})
