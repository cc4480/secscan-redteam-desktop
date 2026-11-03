/**
 * A3 Deep — context compaction + summary cache (PentAGI csum pattern).
 *
 * The benchmark block is the no-recall-loss gate in miniature: a history
 * planted with load-bearing facts is compacted by an extractive
 * summarizer (one that keeps fact lines, drops filler — the behavior the
 * production summarizer is instructed to have), and every planted fact
 * must survive in the compacted chain while the chain shrinks. Live
 * model recall is proven separately on the lab battery; this gate
 * proves the mechanism never drops what the summarizer returns, never
 * touches the preserved head/tail, and never re-summarizes a slice it
 * has already paid for.
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
  type ChatMessage,
} from '@secscan/redteam-llm-router'
import { SummaryCache, summaryKey } from '../src/compaction/summary-cache.js'
import {
  compactMessages,
  estimateChars,
  SUMMARY_MARKER,
} from '../src/compaction/compact.js'
import { agentLoop } from '../src/agents.js'
import { EventLog, readEvents } from '../src/events.js'
import { readSteps } from '../src/harness2/steps.js'
import type { Ctx } from '../src/context.js'
import type { EngagementPhase } from '../src/types.js'

/** Extractive fake: keeps FACT lines, drops filler — the instructed behavior. */
function extractiveSummarizer(counter: { calls: number }) {
  return async (sliceText: string): Promise<string> => {
    counter.calls++
    return sliceText
      .split('\n')
      .filter(line => line.includes('FACT:'))
      .join('\n')
  }
}

function history(pairs: number, fillerChars = 2_000): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'SYSTEM' },
    { role: 'user', content: 'OBJECTIVE: pentest FACT: target is shop.example.test' },
  ]
  for (let i = 0; i < pairs; i++) {
    messages.push({ role: 'assistant', content: `turn ${i} reasoning ${'x'.repeat(fillerChars)}\nFACT: finding F-${i} status confirmed` })
    messages.push({ role: 'user', content: `observation ${i} ${'y'.repeat(fillerChars)}` })
  }
  return messages
}

describe('summary cache', () => {
  it('keys are stable per slice and differ across slices', () => {
    assert.equal(summaryKey('abc'), summaryKey('abc'))
    assert.notEqual(summaryKey('abc'), summaryKey('abd'))
  })

  it('is an LRU capped at 100 entries with hit/miss accounting', () => {
    const cache = new SummaryCache()
    for (let i = 0; i < 101; i++) cache.set(`k${i}`, `v${i}`)
    assert.equal(cache.size, 100)
    assert.equal(cache.get('k0'), null) // evicted as least recently used
    assert.equal(cache.get('k100'), 'v100')
    assert.equal(cache.hits, 1)
    assert.equal(cache.misses, 1)
  })
})

describe('compactMessages', () => {
  it('is a no-op under budget and never calls the summarizer', async () => {
    const counter = { calls: 0 }
    const messages = history(2, 100)
    const result = await compactMessages(messages, extractiveSummarizer(counter), { budgetChars: 100_000 })
    assert.equal(result, null)
    assert.equal(counter.calls, 0)
  })

  it('compacts the middle, preserving system, objective, and the raw tail', async () => {
    const counter = { calls: 0 }
    const messages = history(20)
    const before = estimateChars(messages)
    const result = await compactMessages(messages, extractiveSummarizer(counter), {
      budgetChars: 20_000,
      preserveLast: 4,
    })
    assert.ok(result)
    assert.ok(result.afterChars < before)
    assert.equal(messages[0]?.content, 'SYSTEM')
    assert.match(messages[1]?.content ?? '', /OBJECTIVE/)
    const summary = messages.find(m => m.content.startsWith(SUMMARY_MARKER))
    assert.ok(summary, 'a summary message replaced the middle')
    // The last 4 raw messages survive verbatim at the tail.
    assert.match(messages[messages.length - 1]?.content ?? '', /observation 19/)
  })

  it('never re-summarizes an identical slice (cache hit on the second run)', async () => {
    const counter = { calls: 0 }
    const cache = new SummaryCache()
    const summarize = extractiveSummarizer(counter)
    await compactMessages(history(20), summarize, { budgetChars: 20_000, preserveLast: 4, cache })
    assert.equal(counter.calls, 1)
    const second = await compactMessages(history(20), summarize, { budgetChars: 20_000, preserveLast: 4, cache })
    assert.equal(counter.calls, 1)
    assert.ok(second && second.cacheHits >= 1)
  })
})

describe('benchmark — planted-fact recall through compaction', () => {
  it('retains every planted fact while shrinking the chain by at least half', async () => {
    const counter = { calls: 0 }
    const messages = history(12, 3_000)
    const before = estimateChars(messages)
    const facts: string[] = ['target is shop.example.test']
    for (let i = 0; i < 12; i++) facts.push(`finding F-${i} status confirmed`)
    const result = await compactMessages(messages, extractiveSummarizer(counter), {
      budgetChars: 15_000,
      preserveLast: 2,
    })
    assert.ok(result)
    const chain = messages.map(m => m.content).join('\n')
    for (const fact of facts) {
      assert.ok(chain.includes(fact), `recall lost: ${fact}`)
    }
    assert.ok(result.afterChars <= before / 2, `expected ≥50% shrink, got ${before} → ${result.afterChars}`)
  })
})

describe('agentLoop compaction seam', () => {
  let dir = ''
  const savedBudget = process.env['REDTEAM_COMPACTION_BUDGET_CHARS']
  beforeEach(() => {
    dir = join(tmpdir(), `compaction-loop-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    process.env['REDTEAM_COMPACTION_BUDGET_CHARS'] = '12000'
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (savedBudget === undefined) delete process.env['REDTEAM_COMPACTION_BUDGET_CHARS']
    else process.env['REDTEAM_COMPACTION_BUDGET_CHARS'] = savedBudget
  })

  it('compacts an over-budget history mid-loop and journals the compacted prompt', async () => {
    let summarizerCalls = 0
    let mainCalls = 0
    const completeForRole = async (_role: unknown, messages: ChatMessage[]) => {
      const first = messages[0]?.content ?? ''
      if (first.includes('compaction summarizer')) {
        summarizerCalls++
        const slice = messages[1]?.content ?? ''
        return { text: slice.split('\n').filter(l => l.includes('FACT:')).join('\n') }
      }
      // Main call: keep the history growing with big, distinct filler turns.
      mainCalls++
      return { text: `working turn ${mainCalls} ${'z'.repeat(3_000)} FACT: still on target shop.example.test` }
    }
    const ctx = {
      actions: 0,
      consecutive5xx: 0,
      startedAt: Date.now(),
      config: { maxActions: 60, maxDurationMs: 60_000 },
      input: { roe: { blackoutWindows: [] } },
      deps: { completeForRole },
      events: new EventLog(dir, 'eng-compact', { target: 'shop.example.test', mode: 'red', objective: 'test' }),
      hostKill: { aborted: false, controllers: new Set<AbortController>() },
      safety: { killSwitchAborts: 0 },
    } as unknown as Ctx
    await agentLoop(ctx, 'recon', 'recon' as EngagementPhase, 'SYS', 'OBJ', [], 6, {
      onIdle: () => 'keep going',
    })
    assert.ok(summarizerCalls >= 1, 'summarizer ran at least once')
    const prompts = readSteps(dir).filter(r => r.role === 'prompt')
    assert.ok(
      prompts.some(r => r.content.includes(SUMMARY_MARKER)),
      'a journaled prompt carries the compacted-history summary (model-visible = logged)',
    )
  })
})

describe('compactMessages — tool-call pairing invariant (Q-HALT Item 3)', () => {
  /**
   * The wire grammar invariant: every `tool` message's toolCallId appears in
   * the toolCalls of the nearest preceding assistant message, and every
   * assistant toolCall id is answered by a tool message before the next
   * non-tool message. A chain violating it serializes tool_call_ids pointing
   * at calls that no longer exist — providers reject it with a 400.
   */
  function assertPairing(messages: readonly ChatMessage[]): void {
    let open: string[] = []
    for (const m of messages) {
      if (m.role === 'tool') {
        assert.ok(
          m.toolCallId !== undefined && open.includes(m.toolCallId),
          `orphaned tool result (toolCallId=${m.toolCallId ?? 'none'})`,
        )
        open = open.filter(id => id !== m.toolCallId)
      } else {
        assert.deepEqual(open, [], `tool call(s) ${open.join(',')} never answered before a non-tool message`)
        if (m.role === 'assistant' && m.toolCalls) open = m.toolCalls.map(c => c.id)
      }
    }
    assert.deepEqual(open, [], `tool call(s) ${open.join(',')} never answered at chain end`)
  }

  /** One assistant turn carrying `count` tool calls, followed by their results. */
  function toolGroup(label: string, count: number, fillerChars = 200): ChatMessage[] {
    const calls = Array.from({ length: count }, (_, i) => ({
      id: `${label}-call-${i}`,
      name: 'probe',
      arguments: { target: `${label}-${i}` },
    }))
    return [
      { role: 'assistant', content: `${label} CALL ${'q'.repeat(fillerChars)}\nFACT: ${label} opened ${count} call(s)`, toolCalls: calls },
      ...calls.map((c, i) => ({
        role: 'tool' as const,
        content: `${label} RESULT ${i}`,
        toolCallId: c.id,
      })),
    ]
  }

  /** Head + three plain filler pairs, then one tool group at the very end. */
  function groupAtEnd(resultCount: number): ChatMessage[] {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'OBJECTIVE' },
    ]
    for (let i = 0; i < 3; i++) {
      messages.push({ role: 'assistant', content: `mid ${i} reasoning ${'x'.repeat(1_500)}\nFACT: mid-${i} observed` })
      messages.push({ role: 'user', content: `mid ${i} observation ${'y'.repeat(1_500)}` })
    }
    messages.push(...toolGroup('GROUP', resultCount))
    return messages
  }

  for (const resultCount of [1, 2, 3]) {
    it(`pulls the boundary back so a ${resultCount}-result tool group survives whole in the tail`, async () => {
      const counter = { calls: 0 }
      const messages = groupAtEnd(resultCount)
      // preserveLast = resultCount: the naive boundary lands immediately
      // AFTER the call-carrying assistant, orphaning its results in the tail.
      const result = await compactMessages(messages, extractiveSummarizer(counter), {
        budgetChars: 4_000,
        preserveLast: resultCount,
      })
      assert.ok(result)
      assert.equal(result.compactedCount, 6, 'only the three filler pairs were summarized')
      assertPairing(messages)
      const callAt = messages.findIndex(m => m.content.startsWith('GROUP CALL'))
      assert.ok(callAt >= 0, 'the call-carrying assistant survives verbatim')
      assert.equal(messages[callAt]?.toolCalls?.length, resultCount)
      for (let i = 0; i < resultCount; i++) {
        assert.equal(messages[callAt + 1 + i]?.role, 'tool')
        assert.equal(messages[callAt + 1 + i]?.toolCallId, `GROUP-call-${i}`)
        assert.equal(messages[callAt + 1 + i]?.content, `GROUP RESULT ${i}`)
      }
    })
  }

  it('pulls the boundary back when the tail would open inside a tool group (eng-2026-11-02-wcsu shape)', async () => {
    const counter = { calls: 0 }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'OBJECTIVE' },
    ]
    for (let i = 0; i < 2; i++) {
      messages.push({ role: 'assistant', content: `mid ${i} reasoning ${'x'.repeat(1_500)}\nFACT: mid-${i} observed` })
      messages.push({ role: 'user', content: `mid ${i} observation ${'y'.repeat(1_500)}` })
    }
    // The wcsu group: one assistant turn, three parallel calls, three results.
    messages.push(...toolGroup('GROUP', 3))
    messages.push(...toolGroup('NEXT', 1))
    messages.push(...toolGroup('LAST', 1))
    // preserveLast 6: the naive boundary lands on GROUP's third result —
    // the slice would swallow the call and its first two results while the
    // third result survives in the tail, orphaned. The boundary must pull
    // back to GROUP's assistant so only the filler pairs are summarized.
    const result = await compactMessages(messages, extractiveSummarizer(counter), {
      budgetChars: 4_000,
      preserveLast: 6,
    })
    assert.ok(result)
    assert.equal(result.compactedCount, 4, 'only the two filler pairs were summarized')
    assertPairing(messages)
    const callAt = messages.findIndex(m => m.content.startsWith('GROUP CALL'))
    assert.ok(callAt >= 0, 'the group-opening assistant survives verbatim')
    assert.equal(messages[callAt]?.toolCalls?.length, 3)
    for (let i = 0; i < 3; i++) {
      assert.equal(messages[callAt + 1 + i]?.toolCallId, `GROUP-call-${i}`)
    }
  })

  it('compacts nothing rather than sever the only group the boundary can reach', async () => {
    const counter = { calls: 0 }
    // The exact wcsu arithmetic: head + one 3-call group + two 1-call
    // groups (10 messages), preserveLast 6 — the naive slice is exactly
    // [the group-opening assistant, its first result]. Pulling the boundary
    // back to the assistant empties the slice, so compaction must stand
    // down and ship the chain uncompacted rather than invalid.
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'OBJECTIVE' },
      ...toolGroup('GROUP', 3, 1_800),
      ...toolGroup('NEXT', 1, 1_800),
      ...toolGroup('LAST', 1, 1_800),
    ]
    const result = await compactMessages(messages, extractiveSummarizer(counter), {
      budgetChars: 4_000,
      preserveLast: 6,
    })
    assert.ok(result === null || result.compactedCount === 0, 'no message was compacted away')
    assert.equal(counter.calls, 0, 'the summarizer was never invoked')
    assertPairing(messages)
    assert.equal(messages.length, 10, 'history untouched')
  })

  it('holds the invariant across repeated compaction waves as the history regrows', async () => {
    const counter = { calls: 0 }
    const summarize = extractiveSummarizer(counter)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'OBJECTIVE' },
    ]
    for (const label of ['W1', 'W2', 'W3', 'W4']) messages.push(...toolGroup(label, 2, 1_800))
    // Wave 1: the naive boundary (preserveLast 2) lands after W4's call.
    const wave1 = await compactMessages(messages, summarize, { budgetChars: 5_000, preserveLast: 2 })
    assert.ok(wave1)
    assert.equal(wave1.passes, 1)
    assertPairing(messages)
    assert.ok(messages.some(m => m.content.startsWith('W4 CALL')), 'W4 group survived wave 1 whole')
    // The loop runs on and the history regrows past the budget again.
    for (const label of ['W5', 'W6']) messages.push(...toolGroup(label, 2, 1_800))
    const wave2 = await compactMessages(messages, summarize, { budgetChars: 5_000, preserveLast: 2 })
    assert.ok(wave2)
    assert.equal(wave2.passes, 1)
    assertPairing(messages)
    assert.ok(messages.some(m => m.content.startsWith('W6 CALL')), 'W6 group survived wave 2 whole')
    assert.ok(messages.some(m => m.content.startsWith(SUMMARY_MARKER)), 'wave 2 left a summary behind')
  })

  it("leaves an already group-aligned boundary's behavior unchanged", async () => {
    const counter = { calls: 0 }
    const messages = history(10, 1_500) // plain assistant/user pairs — no tool calls anywhere
    const lengthBefore = messages.length
    const result = await compactMessages(messages, extractiveSummarizer(counter), {
      budgetChars: 5_000,
      preserveLast: 4,
    })
    assert.ok(result)
    // Pre-fix arithmetic on the same fixture: one pass over [head, len - preserveLast).
    assert.equal(result.compactedCount, lengthBefore - 4 - 2)
    assert.equal(result.passes, 1)
    assertPairing(messages)
  })

  it('skips compaction when the slice would open with a tool message (malformed input)', async () => {
    const counter = { calls: 0 }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'OBJECTIVE' },
      { role: 'tool', content: 'orphaned result', toolCallId: 'ghost' },
    ]
    for (let i = 0; i < 4; i++) {
      messages.push({ role: 'assistant', content: `later ${i} ${'x'.repeat(1_500)}\nFACT: later-${i}` })
      messages.push({ role: 'user', content: `later ${i} obs ${'y'.repeat(1_500)}` })
    }
    const before = JSON.parse(JSON.stringify(messages)) as ChatMessage[]
    const result = await compactMessages(messages, extractiveSummarizer(counter), {
      budgetChars: 4_000,
      preserveLast: 2,
    })
    assert.equal(result, null)
    assert.equal(counter.calls, 0, 'the summarizer was never invoked')
    assert.deepEqual(messages, before, 'history untouched')
  })
})

describe('agentLoop llm_error cause surfacing (Q-HALT Item 1)', () => {
  it('records the classification and the provider cause on llm_error, and closes the loop instead of throwing', async () => {
    const dir2 = join(tmpdir(), `llm-error-${process.pid}-${Date.now()}`)
    mkdirSync(dir2, { recursive: true })
    try {
      // The brief §8 fixture: a safety rejection wrapped by the executor.
      const body =
        '{"error":{"code":"safety_blocked","message":"Request blocked by the safety system: the submitted content may violate policy."}}'
      const providerError = await providerErrorFromResponse('meta', 'Meta', new Response(body, { status: 400 }))
      const failure = new ResilienceError(classifyError(providerError), 1, providerError)
      const completeForRole = async (): Promise<never> => {
        throw failure
      }
      const ctx = {
        actions: 0,
        consecutive5xx: 0,
        startedAt: Date.now(),
        config: { maxActions: 60, maxDurationMs: 60_000 },
        input: { roe: { blackoutWindows: [] } },
        deps: { completeForRole },
        events: new EventLog(dir2, 'eng-llm-error', { target: 'shop.example.test', mode: 'red', objective: 'test' }),
        hostKill: { aborted: false, controllers: new Set<AbortController>() },
        safety: { killSwitchAborts: 0 },
      } as unknown as Ctx
      // Q-NOHALT: a provider failure is an infrastructure limitation, not a
      // reason to discard the engagement. The loop records the failure, marks
      // the fleet down so no other seat burns calls, and CLOSES — it does not
      // throw, because throwing used to halt the whole run.
      const text = await agentLoop(ctx, 'coordinator', 'exploit' as EngagementPhase, 'SYS', 'OBJ', [], 3)
      assert.equal(text, '', 'no text is produced when the fleet is down')
      assert.equal(ctx.llmDown, true, 'the fleet is marked down for the remaining phases')
      const errors = readEvents(dir2).filter(e => e.action === 'llm_error')
      assert.equal(errors.length, 1)
      assert.match(errors[0]?.result ?? '', /content_policy/, 'the classification is on the event')
      assert.match(errors[0]?.result ?? '', /safety system/, 'a provider body fragment is on the event')
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })
})
