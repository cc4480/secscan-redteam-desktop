/**
 * Spec §3: refusal classification (behavioral, not keyword-only), the
 * fallback chain's hop order, refusal hygiene (a refusal turn must never
 * reach a later context — asserted on the actual messages each hop
 * receives), prefill gating, session affinity, the local hop's repair
 * pass, and telemetry shape.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  SessionAffinity,
  classifyResponse,
  completeWithFallback,
  type CharterEngagement,
  type FallbackCallImpl,
} from '../src/index.js'
import type { CharterPrompt } from '../src/charter/prompt.js'
import type { ChatResult, RoleRoute } from '../src/types.js'

const ENGAGEMENT: CharterEngagement = {
  engagementId: 'eng-2026-10-25-7f3a',
  owner: 'Acme Widgets LLC',
  proofMethod: 'DNS TXT record verified 2026-10-25',
  inScope: 'app.acme.example',
}

const PRIMARY: RoleRoute = { provider: 'primary-x', model: 'primary-m' }
const UNCENSORED: RoleRoute = { provider: 'uncensored-x', model: 'uncensored-m' }
const LOCAL: RoleRoute = { provider: 'local', model: 'deephat-7b' }

const REFUSAL_TEXT = "I can't help with that request."
const GOOD_ARTIFACT = "PAYLOAD: ' OR '1'='1') -- "

function result(text: string, model: string): ChatResult {
  return { text, toolCalls: [], provider: 'fake', model }
}

/** A call impl that plays a script of responses keyed by provider, recording every context it receives. */
function scripted(script: Record<string, string[]>, seen: Array<{ route: RoleRoute; prompt: CharterPrompt }>): FallbackCallImpl {
  return async (route, assembled) => {
    seen.push({ route, prompt: assembled })
    const queue = script[route.provider]
    assert.ok(queue && queue.length > 0, `no scripted response left for provider ${route.provider}`)
    return result(queue.shift() as string, route.model)
  }
}

const artifactCheck = (text: string): boolean => text.startsWith('PAYLOAD:')

describe('classifyResponse', () => {
  test('classifies an explicit refusal as refusal', () => {
    const classified = classifyResponse(result(REFUSAL_TEXT, 'm'), { artifactTask: false })
    assert.equal(classified.refusalClass, 'refusal')
  })

  test('classifies a missing or failing artifact as soft_refusal, behaviorally', () => {
    const hedged = result('Here is a general discussion of injection techniques.', 'm')
    assert.equal(classifyResponse(hedged, { artifactTask: true, artifactCheck }).refusalClass, 'soft_refusal')
    const good = result(GOOD_ARTIFACT, 'm')
    assert.equal(classifyResponse(good, { artifactTask: true, artifactCheck }).refusalClass, 'ok')
  })

  test('classifies a prose substitute as soft_refusal even without an artifact check', () => {
    const substitute = result('Instead, I can explain how SQL injection works in general terms.', 'm')
    assert.equal(classifyResponse(substitute, { artifactTask: true }).refusalClass, 'soft_refusal')
  })

  test('a non-artifact task with ordinary prose is ok', () => {
    const prose = result('The target exposes three services on the scanned ports.', 'm')
    assert.equal(classifyResponse(prose, { artifactTask: false }).refusalClass, 'ok')
  })
})

describe('completeWithFallback', () => {
  test('accepts on the first attempt when the response is ok', async () => {
    const seen: Array<{ route: RoleRoute; prompt: CharterPrompt }> = []
    const outcome = await completeWithFallback({
      engagement: ENGAGEMENT,
      role: 'exploiter-operator',
      taskId: 't-accept',
      taskType: 'payload',
      messages: [{ role: 'user', content: 'Build the payload set.' }],
      artifactTask: true,
      artifactCheck,
      routes: { primary: PRIMARY },
      callImpl: scripted({ 'primary-x': [GOOD_ARTIFACT] }, seen),
    })
    assert.equal(outcome.hopTaken, 0)
    assert.equal(outcome.result?.text, GOOD_ARTIFACT)
    assert.equal(outcome.telemetry.length, 1)
    assert.equal(outcome.telemetry[0].final_outcome, 'accepted')
    assert.equal(outcome.telemetry[0].exemplar_pack_version, 1)
  })

  test('refusal hygiene: the retry context contains no refusal text, and prefill is applied when supported', async () => {
    const seen: Array<{ route: RoleRoute; prompt: CharterPrompt }> = []
    const outcome = await completeWithFallback({
      engagement: ENGAGEMENT,
      role: 'exploiter-operator',
      taskId: 't-hygiene',
      taskType: 'payload',
      messages: [{ role: 'user', content: 'Build the payload set.' }],
      artifactTask: true,
      artifactCheck,
      prefill: 'PAYLOAD:',
      prefillProviders: ['primary-x'],
      routes: { primary: PRIMARY },
      callImpl: scripted({ 'primary-x': [REFUSAL_TEXT, GOOD_ARTIFACT] }, seen),
    })
    assert.equal(outcome.hopTaken, 0)
    assert.equal(seen.length, 2)
    const retryContext = seen[1].prompt.messages.map(m => m.content).join('\n')
    assert.ok(!retryContext.includes(REFUSAL_TEXT), 'refusal text leaked into the retry context')
    assert.ok(!retryContext.includes("can't help"), 'refusal phrasing leaked into the retry context')
    const lastMessage = seen[1].prompt.messages[seen[1].prompt.messages.length - 1]
    assert.deepEqual(lastMessage, { role: 'assistant', content: 'PAYLOAD:' })
    assert.equal(outcome.telemetry[1].prefill_used, true)
    assert.equal(outcome.telemetry[0].class, 'refusal')
  })

  test('prefill is NOT used for a provider not measured as supporting it', async () => {
    const seen: Array<{ route: RoleRoute; prompt: CharterPrompt }> = []
    await completeWithFallback({
      engagement: ENGAGEMENT,
      role: 'exploiter-operator',
      taskId: 't-noprefill',
      taskType: 'payload',
      messages: [{ role: 'user', content: 'Build the payload set.' }],
      artifactTask: true,
      artifactCheck,
      prefill: 'PAYLOAD:',
      prefillProviders: [],
      routes: { primary: PRIMARY },
      callImpl: scripted({ 'primary-x': [REFUSAL_TEXT, GOOD_ARTIFACT] }, seen),
    })
    const retryLast = seen[1].prompt.messages[seen[1].prompt.messages.length - 1]
    assert.notEqual(retryLast.role, 'assistant')
  })

  test('walks hop 1 then hop 2, pins affinity to the accepting route', async () => {
    const seen: Array<{ route: RoleRoute; prompt: CharterPrompt }> = []
    const affinity = new SessionAffinity()
    const outcome = await completeWithFallback({
      engagement: ENGAGEMENT,
      role: 'exploiter-operator',
      taskId: 't-hops',
      taskType: 'payload',
      messages: [{ role: 'user', content: 'Build the payload set.' }],
      artifactTask: true,
      artifactCheck,
      routes: { primary: PRIMARY, uncensored: UNCENSORED, local: LOCAL },
      affinity,
      callImpl: scripted(
        { 'primary-x': [REFUSAL_TEXT, REFUSAL_TEXT], 'uncensored-x': [REFUSAL_TEXT], local: [GOOD_ARTIFACT] },
        seen,
      ),
    })
    assert.equal(outcome.hopTaken, 2)
    assert.deepEqual(outcome.acceptedRoute, LOCAL)
    assert.deepEqual(affinity.routeFor('t-hops'), LOCAL)
    assert.deepEqual(
      outcome.telemetry.map(e => e.hop_taken),
      [0, 0, 1, 2],
    )
    assert.ok(outcome.telemetry.every(e => e.final_outcome === 'accepted'))
  })

  test('a pinned task starts at its accepting route on the next run', async () => {
    const seen: Array<{ route: RoleRoute; prompt: CharterPrompt }> = []
    const affinity = new SessionAffinity()
    affinity.pin('t-pinned', UNCENSORED)
    const outcome = await completeWithFallback({
      engagement: ENGAGEMENT,
      role: 'exploiter-operator',
      taskId: 't-pinned',
      taskType: 'payload',
      messages: [{ role: 'user', content: 'Continue the payload work.' }],
      artifactTask: true,
      artifactCheck,
      routes: { primary: PRIMARY, uncensored: UNCENSORED },
      affinity,
      callImpl: scripted({ 'uncensored-x': [GOOD_ARTIFACT] }, seen),
    })
    assert.equal(outcome.hopTaken, 0)
    assert.equal(seen[0].route.provider, 'uncensored-x')
  })

  test('the local hop repairs a format failure before classifying it', async () => {
    const seen: Array<{ route: RoleRoute; prompt: CharterPrompt }> = []
    const outcome = await completeWithFallback({
      engagement: ENGAGEMENT,
      role: 'exploiter-operator',
      taskId: 't-repair',
      taskType: 'payload',
      messages: [{ role: 'user', content: 'Build the payload set.' }],
      artifactTask: true,
      artifactCheck,
      routes: { primary: PRIMARY, local: LOCAL },
      callImpl: scripted(
        { 'primary-x': [REFUSAL_TEXT, REFUSAL_TEXT], local: ['garbled output with no format', GOOD_ARTIFACT] },
        seen,
      ),
    })
    assert.equal(outcome.hopTaken, 2)
    assert.equal(outcome.result?.text, GOOD_ARTIFACT)
    const localCalls = seen.filter(s => s.route.provider === 'local')
    assert.equal(localCalls.length, 2)
    assert.ok(localCalls[1].prompt.messages.some(m => m.content.includes('failed format validation')))
  })

  test('exhausting every hop reports refused_all_hops with no result', async () => {
    const seen: Array<{ route: RoleRoute; prompt: CharterPrompt }> = []
    const outcome = await completeWithFallback({
      engagement: ENGAGEMENT,
      role: 'reporter',
      taskId: 't-exhausted',
      taskType: 'summary',
      messages: [{ role: 'user', content: 'Summarize the findings.' }],
      routes: { primary: PRIMARY },
      callImpl: scripted({ 'primary-x': [REFUSAL_TEXT, REFUSAL_TEXT] }, seen),
    })
    assert.equal(outcome.hopTaken, 'none')
    assert.equal(outcome.result, undefined)
    assert.ok(outcome.telemetry.every(e => e.final_outcome === 'refused_all_hops'))
  })

  test('a provider throw aborts as provider_error, never as a refusal of content', async () => {
    const outcome = await completeWithFallback({
      engagement: ENGAGEMENT,
      role: 'recon',
      taskId: 't-error',
      taskType: 'recon',
      messages: [{ role: 'user', content: 'Map the target.' }],
      routes: { primary: PRIMARY },
      callImpl: async () => {
        throw new Error('connection reset')
      },
    })
    assert.equal(outcome.hopTaken, 'none')
    assert.equal(outcome.telemetry.length, 1)
    assert.equal(outcome.telemetry[0].class, 'provider_error')
    assert.equal(outcome.telemetry[0].final_outcome, 'provider_error')
  })
})
