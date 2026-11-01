/**
 * Wire-level coverage of the share proxy and the Arsenal bridge against a
 * stub console: the bearer is attached here and only here, JSON and event
 * streams pass through unbuffered, request bodies reach the console, and a
 * dead console answers 502 rather than hanging or leaking the token.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, get as httpGet, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { callArsenalTool, isArsenalToolName } from '../src/arsenal.js'
import { normalizeConsoleBaseUrl, proxyToConsole, type ConsoleTarget } from '../src/proxy.js'

const TOKEN = 'test-token-fixture'

/** What the stub console observed on its last request. */
const observed = {
  authorization: undefined as string | undefined,
  body: '',
  mcpCalls: [] as { name: string; arguments: unknown }[],
}

let consoleServer: Server
let consolePort: number
let frontServer: Server
let frontPort: number
let target: ConsoleTarget

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve((server.address() as AddressInfo).port) })
  })
}

before(async () => {
  consoleServer = createServer((req, res) => {
    observed.authorization = req.headers['authorization']
    if (req.url === '/api/console/engagements') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ available: true, engagements: [{ id: 'eng-fixture-1' }] }))
      return
    }
    if (req.url?.startsWith('/api/engagements/eng-fixture-1/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: state\ndata: {"status":"running"}\n\n')
      setTimeout(() => {
        res.write('event: done\ndata: {"status":"complete"}\n\n')
        res.end()
      }, 60)
      return
    }
    if (req.url?.startsWith('/api/engagements/eng-fixture-1/abort')) {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      req.on('end', () => {
        observed.body = Buffer.concat(chunks).toString('utf8')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      return
    }
    if (req.url === '/mcp') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      req.on('end', () => {
        const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method: string
          params: { name: string; arguments: unknown }
        }
        assert.equal(rpc.method, 'tools/call')
        observed.mcpCalls.push({ name: rpc.params.name, arguments: rpc.params.arguments })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: JSON.stringify({ topics: [{ id: 'web', collections: 3 }] }) }] },
        }))
      })
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'unknown' }))
  })
  consolePort = await listen(consoleServer)
  target = { baseUrl: `http://127.0.0.1:${consolePort}`, token: TOKEN }
  frontServer = createServer((req, res) => {
    const url = new URL(String(req.url), 'http://localhost')
    proxyToConsole(target, req, res, `${url.pathname}${url.search}`)
  })
  frontPort = await listen(frontServer)
})

after(async () => {
  await Promise.all([
    new Promise<void>((resolve) => { consoleServer.close(() => { resolve() }) }),
    new Promise<void>((resolve) => { frontServer.close(() => { resolve() }) }),
  ])
})

/** Fetch a URL to completion as text. */
function fetchText(url: string, init: { method?: string; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: init.method ?? 'GET' }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }) })
    })
    req.on('error', reject)
    req.end(init.body)
  })
}

describe('console-share proxy', () => {
  it('normalizes the MCP form of the console address to its base URL', () => {
    assert.equal(normalizeConsoleBaseUrl('http://127.0.0.1:8787/mcp'), 'http://127.0.0.1:8787')
    assert.equal(normalizeConsoleBaseUrl('http://127.0.0.1:8787/mcp/'), 'http://127.0.0.1:8787')
    assert.equal(normalizeConsoleBaseUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787')
    assert.equal(normalizeConsoleBaseUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787')
  })

  it('returns the console JSON and attaches the bearer server-side', async () => {
    const { status, body } = await fetchText(`http://127.0.0.1:${frontPort}/api/console/engagements`)
    assert.equal(status, 200)
    assert.deepEqual(JSON.parse(body), { available: true, engagements: [{ id: 'eng-fixture-1' }] })
    assert.equal(observed.authorization, `Bearer ${TOKEN}`)
  })

  it('streams the event feed chunk by chunk instead of buffering it', async () => {
    const arrivals: { at: number; text: string }[] = await new Promise((resolve, reject) => {
      const collected: { at: number; text: string }[] = []
      const started = Date.now()
      httpGet(`http://127.0.0.1:${frontPort}/api/engagements/eng-fixture-1/events?after=0`, (res) => {
        assert.equal(res.headers['content-type'], 'text/event-stream')
        res.on('data', (chunk: Buffer) => {
          collected.push({ at: Date.now() - started, text: chunk.toString('utf8') })
        })
        res.on('end', () => { resolve(collected) })
      }).on('error', reject)
    })
    assert.ok(arrivals.length >= 2, `expected streamed chunks, got ${arrivals.length}`)
    assert.match(arrivals[0]!.text, /event: state/)
    const last = arrivals[arrivals.length - 1]!
    assert.match(last.text, /event: done/)
    // The done event is written 60 ms after the state event; buffered
    // delivery would land both in one chunk at the end.
    assert.ok(last.at - arrivals[0]!.at >= 40, `chunks arrived together (${last.at - arrivals[0]!.at} ms apart)`)
  })

  it('forwards a POST body to the console verbatim', async () => {
    const { status, body } = await fetchText(
      `http://127.0.0.1:${frontPort}/api/engagements/eng-fixture-1/abort`,
      { method: 'POST', body: JSON.stringify({ reason: 'operator abort from UI' }) },
    )
    assert.equal(status, 200)
    assert.deepEqual(JSON.parse(body), { ok: true })
    assert.deepEqual(JSON.parse(observed.body), { reason: 'operator abort from UI' })
  })

  it('answers 502 when the console is unreachable', async () => {
    const dead: ConsoleTarget = { baseUrl: 'http://127.0.0.1:1', token: TOKEN }
    const front = createServer((req, res) => {
      const url = new URL(String(req.url), 'http://localhost')
      proxyToConsole(dead, req, res, url.pathname)
    })
    const port = await listen(front)
    try {
      const { status, body } = await fetchText(`http://127.0.0.1:${port}/api/console/engagements`)
      assert.equal(status, 502)
      assert.equal((JSON.parse(body) as { code: string }).code, 'console-unavailable')
      assert.ok(!body.includes(TOKEN), 'the error must not carry the token')
    } finally {
      await new Promise<void>((resolve) => { front.close(() => { resolve() }) })
    }
  })
})

describe('console-share arsenal bridge', () => {
  it('allows exactly the three read-only tools', () => {
    assert.equal(isArsenalToolName('arsenal_search'), true)
    assert.equal(isArsenalToolName('arsenal_browse'), true)
    assert.equal(isArsenalToolName('arsenal_recommend'), true)
    assert.equal(isArsenalToolName('engagement_launch'), false)
    assert.equal(isArsenalToolName('nuclei_exec'), false)
    assert.equal(isArsenalToolName('arsenal_drop'), false)
  })

  it('calls tools/call on /mcp and returns the parsed tool JSON', async () => {
    const outcome = await callArsenalTool(target, 'arsenal_browse', {})
    assert.equal(outcome.status, 200)
    assert.deepEqual(outcome.payload, { topics: [{ id: 'web', collections: 3 }] })
    assert.deepEqual(observed.mcpCalls[observed.mcpCalls.length - 1], { name: 'arsenal_browse', arguments: {} })
    assert.equal(observed.authorization, `Bearer ${TOKEN}`)
  })

  it('answers 502 when the console is unreachable', async () => {
    const outcome = await callArsenalTool({ baseUrl: 'http://127.0.0.1:1', token: TOKEN }, 'arsenal_search', { query: 'x' })
    assert.equal(outcome.status, 502)
    assert.equal((outcome.payload as { code: string }).code, 'console-unavailable')
  })
})
