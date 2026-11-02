/**
 * Tool-pairing guarantee at the provider boundary (eng-2026-11-02-wcsu).
 *
 * The live halt: context compaction severed a parallel tool group — the
 * assistant message carrying three tool_calls was summarized away while
 * two of its tool results survived — and the next request shipped with
 * role='tool' messages whose tool_call_id had no matching assistant
 * message. Meta rejected it (400 invalid_request_error, param
 * messages[].tool_call_id) and the engagement halted mid-exploit.
 *
 * These tests pin the boundary repair: whatever history a caller hands
 * in, the request that leaves for the provider is internally consistent,
 * and every repair is reported (dropped/pruned ids), never silent.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ChatMessage } from '../src/types.js'
import { sanitizeToolPairing, toWireMessages } from '../src/providers/openai-wire.js'
import { MetaProvider } from '../src/providers/meta.js'
import { META_API_KEY_ENV } from '../src/providers/meta.js'

// The wcsu orphan ids, verbatim from the engagement record (steps seq 202).
const ORPHAN_NMAP = 'call_8f0a68cf-6044-4434-8048-d79c922c1979'
const ORPHAN_SECSCAN = 'call_f018a342-9177-43ea-82f5-cc8049ee151e'
const LIVE_CALL = 'call_23589106-27b4-4322-8c3e-183bd791c6c9'

/** The severed history exactly as journaled in the wcsu run's final prompt. */
function wcsuHistory(): ChatMessage[] {
  return [
    { role: 'system', content: 'You are an agent of SecScan RedTeam' },
    { role: 'user', content: 'COMMANDER REDIRECT — focused exploitation' },
    { role: 'user', content: '[COMPACTED HISTORY — summary of 2 earlier messages, digest 9f31] targets and facts' },
    { role: 'tool', toolCallId: ORPHAN_NMAP, content: 'nmap profiles list' },
    { role: 'tool', toolCallId: ORPHAN_SECSCAN, content: 'secscan_exec failed: loopback guard' },
    {
      role: 'assistant',
      content: 'pivoting to raw sockets',
      toolCalls: [{ id: LIVE_CALL, name: 'net_exec', arguments: { action: 'caps' } }],
    },
    { role: 'tool', toolCallId: LIVE_CALL, content: 'net_exec routes: socket_open/send/recv/close' },
  ]
}

/** Assert the OpenAI wire grammar: every tool message answers an open call. */
function assertWirePairing(wire: Array<Record<string, unknown>>): void {
  let open: string[] = []
  for (const m of wire) {
    if (m['role'] === 'tool') {
      assert.ok(open.includes(m['tool_call_id'] as string), `orphaned wire tool message: ${String(m['tool_call_id'])}`)
      open = open.filter(id => id !== m['tool_call_id'])
    } else {
      assert.deepEqual(open, [], `wire tool call(s) ${open.join(',')} never answered before a non-tool message`)
      const calls = (m['tool_calls'] as Array<Record<string, unknown>> | undefined) ?? []
      open = calls.map(c => c['id'] as string)
    }
  }
  assert.deepEqual(open, [], `wire tool call(s) ${open.join(',')} never answered at end`)
}

describe('sanitizeToolPairing', () => {
  test('drops the wcsu orphans and keeps the surviving group intact', () => {
    const repair = sanitizeToolPairing(wcsuHistory())
    assert.deepEqual(repair.droppedToolCallIds, [ORPHAN_NMAP, ORPHAN_SECSCAN])
    assert.deepEqual(repair.prunedToolCallIds, [])
    assert.equal(repair.messages.length, 5)
    assertWirePairing(toWireMessages(wcsuHistory()))
  })

  test('passes a well-formed conversation through unchanged', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'OBJ' },
      {
        role: 'assistant',
        content: 'working',
        toolCalls: [
          { id: 'a', name: 'probe', arguments: {} },
          { id: 'b', name: 'probe', arguments: {} },
        ],
      },
      { role: 'tool', toolCallId: 'a', content: 'ra' },
      { role: 'tool', toolCallId: 'b', content: 'rb' },
      { role: 'assistant', content: 'done' },
    ]
    const repair = sanitizeToolPairing(messages)
    assert.deepEqual(repair.droppedToolCallIds, [])
    assert.deepEqual(repair.prunedToolCallIds, [])
    assert.deepEqual(repair.messages, messages)
  })

  test('prunes a declared call its group closed without answering', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'OBJ' },
      {
        role: 'assistant',
        content: 'two probes',
        toolCalls: [
          { id: 'kept', name: 'probe', arguments: {} },
          { id: 'lost', name: 'probe', arguments: {} },
        ],
      },
      { role: 'tool', toolCallId: 'kept', content: 'answer' },
      { role: 'user', content: 'move on' },
    ]
    const repair = sanitizeToolPairing(messages)
    assert.deepEqual(repair.prunedToolCallIds, ['lost'])
    assert.deepEqual(repair.droppedToolCallIds, [])
    const wire = toWireMessages(messages)
    const assistant = wire.find(m => m['role'] === 'assistant')
    assert.deepEqual((assistant?.['tool_calls'] as Array<Record<string, unknown>>).map(c => c['id']), ['kept'])
    assertWirePairing(wire)
  })

  test('drops a duplicate answer to an already-answered call', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'x', name: 'probe', arguments: {} }] },
      { role: 'tool', toolCallId: 'x', content: 'first' },
      { role: 'tool', toolCallId: 'x', content: 'duplicate' },
    ]
    const repair = sanitizeToolPairing(messages)
    assert.deepEqual(repair.droppedToolCallIds, ['x'])
    assert.equal(repair.messages.filter(m => m.role === 'tool').length, 1)
  })

  test('leaves a trailing open group untouched (the loop answers it next turn)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'OBJ' },
      {
        role: 'assistant',
        content: 'probing',
        toolCalls: [
          { id: 'p', name: 'probe', arguments: {} },
          { id: 'q', name: 'probe', arguments: {} },
        ],
      },
      { role: 'tool', toolCallId: 'p', content: 'answer p' },
    ]
    const repair = sanitizeToolPairing(messages)
    assert.deepEqual(repair.droppedToolCallIds, [])
    assert.deepEqual(repair.prunedToolCallIds, [])
    assert.deepEqual(repair.messages, messages)
  })
})

describe('MetaProvider request body', () => {
  test('ships an internally consistent request for the wcsu history', async () => {
    process.env[META_API_KEY_ENV] = 'test-key'
    const realFetch = globalThis.fetch
    let shipped: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages: Array<Record<string, unknown>> }
      shipped = body.messages
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch
    try {
      const res = await new MetaProvider().complete({ model: 'muse-spark-1.3', messages: wcsuHistory() })
      assert.equal(res.text, 'ok')
    } finally {
      globalThis.fetch = realFetch
      delete process.env[META_API_KEY_ENV]
    }
    assertWirePairing(shipped)
    assert.ok(!shipped.some(m => m['tool_call_id'] === ORPHAN_NMAP), 'the wcsu orphan never reaches the wire')
    assert.ok(!shipped.some(m => m['tool_call_id'] === ORPHAN_SECSCAN), 'the second orphan never reaches the wire')
    assert.ok(shipped.some(m => m['tool_call_id'] === LIVE_CALL), 'the live group survives')
  })
})
