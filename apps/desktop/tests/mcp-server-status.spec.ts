import { describe, expect, it, vi } from 'vitest'
import { probeMcpServers, resolveBridgeMcpEndpoint } from '../src/mcp-server-status.ts'
import type { McpHttpFetch } from '../src/mcp-server-status.ts'

/** One recorded HTTP call the fake transport answered. */
interface RecordedCall {
  url: string
  method: string
  authorization: string | undefined
  sessionId: string | undefined
  body: { method?: string }
}

function jsonResponse(body: unknown, init: { status?: number; sessionId?: string } = {}): Awaited<ReturnType<McpHttpFetch>> {
  const status = init.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'mcp-session-id' ? init.sessionId ?? null : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

const initializeResult = (capabilities: unknown) => ({
  jsonrpc: '2.0', id: 1,
  result: { protocolVersion: '2025-03-26', capabilities, serverInfo: { name: 'fake-server', version: '1' } },
})

/** A fake HTTP transport that answers the MCP handshake for one healthy server with `toolCount` tools. */
function healthyFetch(toolCount: number, calls: RecordedCall[]): McpHttpFetch {
  return async (url, init) => {
    const body = JSON.parse(init.body) as { method?: string }
    calls.push({
      url,
      method: body.method ?? '',
      authorization: init.headers.authorization,
      sessionId: init.headers['mcp-session-id'],
      body,
    })
    if (body.method === 'initialize') return jsonResponse(initializeResult({ tools: {} }), { sessionId: 'sess-1' })
    if (body.method === 'notifications/initialized') return jsonResponse('', { status: 202 })
    if (body.method === 'tools/list') {
      return jsonResponse({
        jsonrpc: '2.0', id: 2,
        result: { tools: Array.from({ length: toolCount }, (_, index) => ({ name: `tool-${index}` })) },
      })
    }
    throw new Error(`unexpected method ${String(body.method)}`)
  }
}

const baseInputs = {
  runnerEndpoint: 'http://127.0.0.1:8787/mcp',
  runnerToken: 'runner-token',
  bridgeUrl: 'http://127.0.0.1:8765',
  bridgeTokenFile: '/profile/token',
  homeDir: '/profile',
}

describe('resolveBridgeMcpEndpoint', () => {
  it('appends /mcp to a bare origin, keeps a pathed URL, and falls back on a malformed one', () => {
    expect(resolveBridgeMcpEndpoint('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765/mcp')
    expect(resolveBridgeMcpEndpoint('https://pc.example.test/custom')).toBe('https://pc.example.test/custom')
    expect(resolveBridgeMcpEndpoint('not a url')).toBe('http://127.0.0.1:8765/mcp')
    expect(resolveBridgeMcpEndpoint(undefined)).toBe('http://127.0.0.1:8765/mcp')
  })
})

describe('probeMcpServers', () => {
  it('reports the two rows with their real states and tool counts', async () => {
    const calls: RecordedCall[] = []
    const fetchImpl: McpHttpFetch = async (url, init) => {
      if (url === 'http://127.0.0.1:8787/mcp') return healthyFetch(3, calls)(url, init)
      if (url === 'http://127.0.0.1:8765/mcp') return healthyFetch(5, calls)(url, init)
      throw new Error(`unexpected url ${url}`)
    }
    const servers = await probeMcpServers(
      { ...baseInputs },
      { fetch: fetchImpl, readTokenFile: async () => '  bridge-token\n' },
    )
    expect(servers.map(server => server.id)).toEqual(['redteam', 'alterego'])
    const redteam = servers.find(server => server.id === 'redteam')!
    expect(redteam.state).toBe('connected')
    expect(redteam.toolCount).toBe(3)
    // The healthy row's handshake carried the row's own token and the issued session id.
    const runnerCalls = calls.filter(call => call.url === 'http://127.0.0.1:8787/mcp')
    expect(runnerCalls.map(call => call.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(runnerCalls[0]!.authorization).toBe('Bearer runner-token')
    expect(runnerCalls[2]!.sessionId).toBe('sess-1')
    // AlterEgo was probed at the bridge's /mcp endpoint with the trimmed paired token.
    const bridgeCalls = calls.filter(call => call.url === 'http://127.0.0.1:8765/mcp')
    expect(bridgeCalls.length).toBeGreaterThan(0)
    expect(bridgeCalls[0]!.authorization).toBe('Bearer bridge-token')
    expect(servers.find(server => server.id === 'alterego')).toMatchObject({ state: 'connected', toolCount: 5 })
  })

  it('names a rejected row failed with its HTTP status as the only detail', async () => {
    const fetchImpl: McpHttpFetch = async () => jsonResponse('unauthorized', { status: 401 })
    const servers = await probeMcpServers(
      { ...baseInputs },
      { fetch: fetchImpl, readTokenFile: async () => 'bridge-token' },
    )
    const redteam = servers.find(server => server.id === 'redteam')!
    expect(redteam.state).toBe('failed')
    expect(redteam.detail).toBe('HTTP 401')
    expect(redteam.toolCount).toBeUndefined()
    expect(servers.find(server => server.id === 'alterego')).toMatchObject({ state: 'failed', detail: 'HTTP 401' })
  })

  it('names a tools-less initialize as no-tools instead of connected, and never asks for its tools', async () => {
    const calls: RecordedCall[] = []
    const fetchImpl: McpHttpFetch = async (url, init) => {
      const body = JSON.parse(init.body) as { method?: string }
      calls.push({ url, method: body.method ?? '', authorization: init.headers.authorization, sessionId: undefined, body })
      if (body.method === 'initialize') return jsonResponse(initializeResult({}))
      throw new Error('a tools-less server must not be asked for tools')
    }
    const servers = await probeMcpServers(
      { ...baseInputs },
      { fetch: fetchImpl, readTokenFile: async () => undefined },
    )
    const redteam = servers.find(server => server.id === 'redteam')!
    expect(redteam.state).toBe('no-tools')
    expect(redteam.toolCount).toBe(0)
    expect(calls.filter(call => call.url === 'http://127.0.0.1:8787/mcp')).toHaveLength(1)
  })

  it('names an unpaired bridge row without probing it', async () => {
    const fetchImpl = vi.fn<McpHttpFetch>(async () => jsonResponse(initializeResult({ tools: {} })))
    const servers = await probeMcpServers(
      { ...baseInputs },
      { fetch: fetchImpl, readTokenFile: async () => '   \n' },
    )
    expect(servers.find(server => server.id === 'alterego')!.state).toBe('unpaired')
    // Only the runner row (always configured) was probed.
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0)
    expect(new Set(fetchImpl.mock.calls.map(call => call[0]))).toEqual(new Set(['http://127.0.0.1:8787/mcp']))
  })

  it('parses an SSE-framed reply and names an unreachable server failed', async () => {
    const fetchImpl: McpHttpFetch = async (_url, init) => {
      const body = JSON.parse(init.body) as { method?: string }
      if (body.method === 'initialize') {
        return jsonResponse(`event: message\ndata: ${JSON.stringify(initializeResult({ tools: {} }))}\n\n`)
      }
      if (body.method === 'notifications/initialized') return jsonResponse('', { status: 202 })
      return jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'only' }] } })
    }
    const servers = await probeMcpServers(
      { ...baseInputs },
      { fetch: fetchImpl, readTokenFile: async () => undefined },
    )
    expect(servers.find(server => server.id === 'redteam')).toMatchObject({ state: 'connected', toolCount: 1 })

    const down = await probeMcpServers(
      { ...baseInputs },
      {
        fetch: async () => { throw new Error('connect ECONNREFUSED') },
        readTokenFile: async () => 'bridge-token',
      },
    )
    expect(down.find(server => server.id === 'redteam')).toMatchObject({ state: 'failed' })
    expect(down.find(server => server.id === 'alterego')).toMatchObject({ state: 'failed' })
  })
})
