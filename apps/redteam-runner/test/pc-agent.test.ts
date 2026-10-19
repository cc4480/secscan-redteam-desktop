/**
 * PC-agent channel: grouped allow-list, autonomy tiers and the action receipt.
 *
 * The channel is a contract until it has talked to a real bridge, so the things
 * that matter here are the closed tool surface (eyes / hands / robot), the tier
 * each tool carries, and that a bridge returning a receipt is understood while a
 * bridge returning plain text still works.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PC_AGENT_ACTION_TOOLS, PC_AGENT_ALLOWED_TOOLS, PC_AGENT_OBSERVE_TOOLS, PC_AGENT_ROBOT_TOOLS,
  createPcAgentClient, parsePcAgentReceipt, pcAgentToolTier, type FetchLike,
} from '../src/host-exec/pc-agent.js'

const cfg = { url: 'http://127.0.0.1:8765/mcp', token: 'x'.repeat(24) }

/** A fetch that answers the MCP handshake and one tools/call with `payload`. */
function fakeFetch(payload: string): FetchLike {
  let calls = 0
  return async (_url, init) => {
    calls += 1
    const body = JSON.parse(init.body) as { method?: string }
    const respond = (text: string, sessionId?: string) => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'mcp-session-id' ? sessionId ?? null : null) },
      text: async () => text,
    })
    if (body.method === 'initialize') {
      return respond(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), 'session-1')
    }
    if (body.method === 'notifications/initialized') return respond('')
    assert.equal(body.method, 'tools/call')
    return respond(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: payload }] } }))
  }
}

describe('pc-agent tool surface', () => {
  it('exposes eyes, hands and robot tools through one closed list', () => {
    assert.ok(PC_AGENT_OBSERVE_TOOLS.includes('screen_snapshot'))
    assert.ok(PC_AGENT_OBSERVE_TOOLS.includes('ui_tree'))
    assert.ok(PC_AGENT_ACTION_TOOLS.includes('ui_invoke'))
    assert.ok(PC_AGENT_ACTION_TOOLS.includes('input_click'))
    assert.ok(PC_AGENT_ROBOT_TOOLS.includes('shell_pwsh'))
    assert.equal(PC_AGENT_ALLOWED_TOOLS.length,
      PC_AGENT_OBSERVE_TOOLS.length + PC_AGENT_ACTION_TOOLS.length + PC_AGENT_ROBOT_TOOLS.length)
    // No duplicates across groups.
    assert.equal(new Set(PC_AGENT_ALLOWED_TOOLS).size, PC_AGENT_ALLOWED_TOOLS.length)
  })

  it('assigns the right autonomy tier to every tool', () => {
    assert.equal(pcAgentToolTier('ui_tree'), 0)
    assert.equal(pcAgentToolTier('ui_invoke'), 1)
    assert.equal(pcAgentToolTier('shell_exec'), 2)
    // Unknown names must be treated as destructive, never as harmless.
    assert.equal(pcAgentToolTier('made_up_tool'), 2)
  })
})

describe('action receipt', () => {
  it('parses a wrapped receipt and an unwrapped one, and ignores plain text', () => {
    const receipt = { ok: true, changed: true, before: { shotHash: 'a' }, after: { shotHash: 'b' } }
    assert.deepEqual(parsePcAgentReceipt(JSON.stringify({ receipt })), receipt)
    assert.deepEqual(parsePcAgentReceipt(JSON.stringify(receipt)), receipt)
    assert.equal(parsePcAgentReceipt('command completed'), undefined)
    assert.equal(parsePcAgentReceipt(JSON.stringify({ status: 'ok' })), undefined)
  })

  it('returns text plus receipt from callWithReceipt, and text alone from call', async () => {
    const receipt = { tool: 'ui_invoke', ok: true, changed: true, assert: { pass: true } }
    const client = createPcAgentClient(cfg, fakeFetch(JSON.stringify({ receipt })))
    const result = await client.callWithReceipt('ui_invoke', { ref: 'n-7' })
    assert.deepEqual(result.receipt, receipt)
    assert.equal(typeof result.text, 'string')

    const plain = createPcAgentClient(cfg, fakeFetch('done'))
    assert.equal(await plain.call('system_info', {}), 'done')
    assert.equal((await plain.callWithReceipt('system_info', {})).receipt, undefined)
  })

  it('refuses a tool outside the allow-list before any request', async () => {
    const client = createPcAgentClient(cfg, fakeFetch('unused'))
    await assert.rejects(() => client.call('not_a_tool' as never, {}), /not on the allow-list/u)
  })
})
