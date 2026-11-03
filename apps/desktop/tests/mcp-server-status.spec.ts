import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { probeMcpServers, resolveBridgeMcpEndpoint } from '../src/mcp-server-status.ts'
import type { McpHttpFetch, McpStdioChild, McpStdioSpawn } from '../src/mcp-server-status.ts'

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

/** A fake stdio child that answers initialize and tools/list over newline-delimited JSON-RPC. */
function healthyStdioChild(toolCount: number): McpStdioChild & { killed: boolean; received: string[] } {
  const stdout = new PassThrough()
  const received: string[] = []
  const child = {
    killed: false,
    received,
    stdin: {
      write: (chunk: string) => {
        received.push(chunk)
        for (const line of chunk.split('\n')) {
          if (line.trim() === '') continue
          const message = JSON.parse(line) as { id?: number; method?: string }
          if (message.method === 'initialize') {
            stdout.write(`${JSON.stringify(initializeResult({ tools: {} }))}\n`)
          } else if (message.method === 'tools/list') {
            stdout.write(`${JSON.stringify({
              jsonrpc: '2.0', id: message.id,
              result: { tools: Array.from({ length: toolCount }, (_, index) => ({ name: `tool-${index}` })) },
            })}\n`)
          }
        }
      },
    },
    stdout: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => { stdout.on(event, listener) } },
    on: (_event: 'exit' | 'error', _listener: (...args: unknown[]) => void) => {},
    kill: () => { child.killed = true },
  }
  return child
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
  it('reports a healthy row and a failed row as different states with their real tool counts', async () => {
    const calls: RecordedCall[] = []
    const fetchImpl: McpHttpFetch = async (url, init) => {
      if (url === 'https://secscan.us/api/mcp') return healthyFetch(3, calls)(url, init)
      if (url === 'http://127.0.0.1:8765/mcp') return healthyFetch(5, calls)(url, init)
      // The runner console rejects the probe: a dead or mis-tokened row.
      const body = JSON.parse(init.body) as { method?: string }
      calls.push({ url, method: body.method ?? '', authorization: init.headers.authorization, sessionId: undefined, body })
      return jsonResponse('unauthorized', { status: 401 })
    }
    const servers = await probeMcpServers(
      { ...baseInputs, secscanToken: 'ssk_test-token' },
      { fetch: fetchImpl, readTokenFile: async () => '  bridge-token\n' },
    )
    expect(servers.map(server => server.id)).toEqual(['secscan', 'seclayer', 'redteam', 'alterego'])
    const secscan = servers.find(server => server.id === 'secscan')!
    expect(secscan.state).toBe('connected')
    expect(secscan.toolCount).toBe(3)
    const redteam = servers.find(server => server.id === 'redteam')!
    expect(redteam.state).toBe('failed')
    expect(redteam.detail).toBe('HTTP 401')
    expect(redteam.toolCount).toBeUndefined()
    // The healthy row's handshake carried the row's own token and the issued session id.
    const secscanCalls = calls.filter(call => call.url === 'https://secscan.us/api/mcp')
    expect(secscanCalls.map(call => call.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(secscanCalls[0]!.authorization).toBe('Bearer ssk_test-token')
    expect(secscanCalls[2]!.sessionId).toBe('sess-1')
    // AlterEgo was probed at the bridge's /mcp endpoint with the trimmed paired token.
    const bridgeCalls = calls.filter(call => call.url === 'http://127.0.0.1:8765/mcp')
    expect(bridgeCalls.length).toBeGreaterThan(0)
    expect(bridgeCalls[0]!.authorization).toBe('Bearer bridge-token')
    expect(servers.find(server => server.id === 'alterego')).toMatchObject({ state: 'connected', toolCount: 5 })
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
      { ...baseInputs, secscanToken: 'ssk_test-token' },
      { fetch: fetchImpl, readTokenFile: async () => undefined },
    )
    const secscan = servers.find(server => server.id === 'secscan')!
    expect(secscan.state).toBe('no-tools')
    expect(secscan.toolCount).toBe(0)
    expect(calls.filter(call => call.url === 'https://secscan.us/api/mcp')).toHaveLength(1)
  })

  it('names unkeyed and unpaired rows without probing them', async () => {
    const fetchImpl = vi.fn<McpHttpFetch>(async () => jsonResponse(initializeResult({ tools: {} })))
    const spawnImpl = vi.fn<McpStdioSpawn>(() => { throw new Error('an unkeyed stdio row must not be spawned') })
    const servers = await probeMcpServers(
      { ...baseInputs },
      { fetch: fetchImpl, spawn: spawnImpl, readTokenFile: async () => '   \n' },
    )
    expect(servers.find(server => server.id === 'secscan')!.state).toBe('unkeyed')
    expect(servers.find(server => server.id === 'seclayer')!.state).toBe('unkeyed')
    expect(servers.find(server => server.id === 'alterego')!.state).toBe('unpaired')
    // Only the runner row (always configured) was probed.
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0)
    expect(new Set(fetchImpl.mock.calls.map(call => call[0]))).toEqual(new Set(['http://127.0.0.1:8787/mcp']))
    expect(spawnImpl).not.toHaveBeenCalled()
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
      { ...baseInputs, secscanToken: 'ssk_test-token' },
      { fetch: fetchImpl, readTokenFile: async () => undefined },
    )
    expect(servers.find(server => server.id === 'secscan')).toMatchObject({ state: 'connected', toolCount: 1 })

    const down = await probeMcpServers(
      { ...baseInputs, secscanToken: 'ssk_test-token' },
      {
        fetch: async () => { throw new Error('connect ECONNREFUSED') },
        readTokenFile: async () => undefined,
      },
    )
    expect(down.find(server => server.id === 'secscan')).toMatchObject({ state: 'failed' })
    expect(down.find(server => server.id === 'redteam')).toMatchObject({ state: 'failed' })
  })

  it('probes the Seclayer stdio row with its key and counts its tools; a child that exits is failed', async () => {
    const child = healthyStdioChild(2)
    const spawnCalls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
    const servers = await probeMcpServers(
      { ...baseInputs, seclayerKey: 'seclayer-test-key' },
      {
        fetch: async () => jsonResponse(initializeResult({ tools: {} })),
        spawn: (command, args, env) => { spawnCalls.push({ command, args, env }); return child },
        readTokenFile: async () => undefined,
        environment: {},
      },
    )
    const seclayer = servers.find(server => server.id === 'seclayer')!
    expect(seclayer.state).toBe('connected')
    expect(seclayer.toolCount).toBe(2)
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]!.args).toEqual(['-y', '@seclayer/mcp@1.0.0'])
    expect(spawnCalls[0]!.env.SECLAYER_API_KEY).toBe('seclayer-test-key')
    expect(child.killed).toBe(true)

    const dead = await probeMcpServers(
      { ...baseInputs, seclayerKey: 'seclayer-test-key' },
      {
        fetch: async () => jsonResponse(initializeResult({ tools: {} })),
        spawn: () => ({
          stdin: { write: () => {} },
          stdout: { on: () => {} },
          on: (event: 'exit' | 'error', listener: (...args: unknown[]) => void) => {
            if (event === 'exit') listener(1)
          },
          kill: () => {},
        }),
        readTokenFile: async () => undefined,
        environment: {},
      },
    )
    expect(dead.find(server => server.id === 'seclayer')!.state).toBe('failed')
  })
})
