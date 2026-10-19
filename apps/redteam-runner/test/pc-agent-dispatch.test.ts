/**
 * Local-PC dispatch gate.
 *
 * The bridge is an operator-paired service; these tests pin the part the runner
 * owns: the tier gate (tier 2 refused without an explicit session flag), the
 * operation/family binding, the clear refusal when the bridge is unconfigured,
 * and that a receipt with changed=false is reported as a failed step.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { ToolCallRequest } from '@secscan/redteam-llm-router'
import { handlePcAgentTools, PC_AGENT_DESTRUCTIVE_ENV } from '../src/dispatch/pc-agent.js'
import type { FetchLike } from '../src/host-exec/pc-agent.js'

const ENV_URL = 'REDTEAM_PC_AGENT_URL'
const ENV_TOKEN = 'REDTEAM_PC_AGENT_TOKEN'
const saved = { url: process.env[ENV_URL], token: process.env[ENV_TOKEN], destructive: process.env[PC_AGENT_DESTRUCTIVE_ENV] }

/** A fetch that completes the MCP handshake and answers tools/call with `payload`. */
function fakeFetch(payload: string): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(init.body) as { method?: string }
    const respond = (text: string, headers: Record<string, string> = {}) => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => text,
    })
    if (body.method === 'initialize') return respond(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { 'mcp-session-id': 's1' })
    if (body.method === 'notifications/initialized') return respond('')
    return respond(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: payload }] } }))
  }
}

/** Invoke the handler the way the router does: call plus parsed args. */
async function invoke(name: string, args: Record<string, unknown>, fetchImpl: FetchLike) {
  const call = { id: 'call-1', name, arguments: args } as ToolCallRequest
  return handlePcAgentTools({} as never, 'recon', 'recon', call, args, fetchImpl)
}

beforeEach(() => {
  process.env[ENV_URL] = 'http://127.0.0.1:8765/mcp'
  process.env[ENV_TOKEN] = 'x'.repeat(24)
  delete process.env[PC_AGENT_DESTRUCTIVE_ENV]
})
afterEach(() => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  restore(ENV_URL, saved.url)
  restore(ENV_TOKEN, saved.token)
  restore(PC_AGENT_DESTRUCTIVE_ENV, saved.destructive)
})

describe('local-PC dispatch gate', () => {
  it('refuses clearly when the bridge is not configured', async () => {
    delete process.env[ENV_URL]
    const result = await invoke('pc_observe', { operation: 'ui_windows' }, fakeFetch('x'))
    assert.equal(result?.ok, false)
    assert.match(result?.result ?? '', /not configured/u)
  })

  it('runs an observe call and returns the bridge text', async () => {
    const result = await invoke('pc_observe', { operation: 'ui_windows' }, fakeFetch('two windows'))
    assert.equal(result?.ok, true)
    assert.equal(result?.result, 'two windows')
  })

  it('refuses a tier-2 call unless the operator enabled it', async () => {
    const refusal = await invoke('pc_run', { operation: 'shell_pwsh', command: 'whoami' }, fakeFetch('x'))
    assert.equal(refusal?.ok, false)
    assert.match(refusal?.result ?? '', /destructive/u)

    process.env[PC_AGENT_DESTRUCTIVE_ENV] = '1'
    const allowed = await invoke('pc_run', { operation: 'shell_pwsh', command: 'whoami' }, fakeFetch('ok'))
    assert.equal(allowed?.ok, true)
  })

  it('binds operations to their family and refuses the rest', async () => {
    const wrongFamily = await invoke('pc_act', { operation: 'shell_pwsh' }, fakeFetch('x'))
    assert.equal(wrongFamily?.ok, false)
    assert.match(wrongFamily?.result ?? '', /does not belong/u)

    const unknown = await invoke('pc_observe', { operation: 'made_up' }, fakeFetch('x'))
    assert.equal(unknown?.ok, false)
  })

  it('treats changed=false or a failed postcondition as a failed step', async () => {
    const unchanged = await invoke('pc_act', { operation: 'input_click' }, fakeFetch(JSON.stringify({ ok: true, changed: false })))
    assert.equal(unchanged?.ok, false)
    assert.match(unchanged?.result ?? '', /UNCHANGED/u)

    const assertFailed = await invoke('pc_act', { operation: 'input_click' }, fakeFetch(JSON.stringify({ ok: true, changed: true, assert: { pass: false } })))
    assert.equal(assertFailed?.ok, false)
    assert.match(assertFailed?.result ?? '', /postcondition/u)
  })
})
