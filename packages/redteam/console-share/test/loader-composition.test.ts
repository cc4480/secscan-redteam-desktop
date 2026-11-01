/**
 * REAL-composition test (packages/AGENTS.md): a test-only cordis.yml boots
 * the real webServer service plus this plugin through the Cordis Loader,
 * with the console replaced by a stub HTTP server (the console is an
 * external process; its wire behavior is the seam) and the connection trust
 * fence stubbed (its real provider is browser-side). The assertions observe
 * the user-visible outcome Phase 0 exists for: a proxied
 * GET /api/console/engagements returning the console's real JSON through
 * the webServer route, the bearer attached server-side only, the Arsenal
 * bridge answering from a tools/call, the fence answering before any proxy
 * work, and disposal removing the route registration.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as consoleShare from '../src/index.js'
import { CONSOLE_SHARE_PREFIX_PATH } from '../src/shared.js'

const TOKEN = 'test-token-fixture'
const ENGAGEMENTS_JSON = {
  available: true,
  generatedAt: '2026-10-31T00:00:00.000Z',
  engagements: [{ id: 'eng-fixture-1', live: true, status: 'running', target: 'fixture.invalid' }],
}

/** What the stub console observed. */
const observed = {
  authorization: undefined as string | undefined,
  mcpNames: [] as string[],
}

/** The fence's current answer; tests flip it to prove the fence runs first. */
let rejection: 401 | 403 | undefined

let consoleServer: Server
let context: Context | undefined
let root: string | undefined
let shareBase: string

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve((server.address() as AddressInfo).port) })
  })
}

/** Fetch a URL to completion as text. */
function fetchText(url: string, init: { method?: string; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }) })
    })
    req.on('error', reject)
    req.end(init.body)
  })
}

/** Poll the booted webServer until it reports its OS-assigned port. */
async function bootedPort(ctx: Context): Promise<number> {
  const webServer = Reflect.get(ctx, 'webServer') as HttpServer
  for (let attempt = 0; attempt < 100; attempt++) {
    if (webServer.port > 0) return webServer.port
    await new Promise((resolve) => { setTimeout(resolve, 50) })
  }
  throw new Error('webServer never listened')
}

before(async () => {
  consoleServer = createServer((req, res) => {
    observed.authorization = req.headers['authorization']
    if (req.url === '/api/console/engagements') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(ENGAGEMENTS_JSON))
      return
    }
    if (req.url === '/mcp') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      req.on('end', () => {
        const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { params: { name: string } }
        observed.mcpNames.push(rpc.params.name)
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
  const consolePort = await listen(consoleServer)

  root = await mkdtemp(join(tmpdir(), 'dsh-redteam-console-share-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@secscan/redteam-console-share'",
    '  config:',
    // The MCP form of the address, exactly as REDTEAM_MCP_URL carries it:
    // the composition proves the plugin derives the console base from it.
    `    baseUrl: 'http://127.0.0.1:${consolePort}/mcp'`,
    `    token: '${TOKEN}'`,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.provide('connection', { requestRejection: () => rejection } as never)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@secscan/redteam-console-share', consoleShare],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  shareBase = `http://127.0.0.1:${await bootedPort(ctx)}`
})

after(async () => {
  await context?.fiber.dispose()
  context = undefined
  await new Promise<void>((resolve) => { consoleServer.close(() => { resolve() }) })
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

describe('console-share real Loader composition', () => {
  it('proxies GET /api/console/engagements through the webServer route', async () => {
    const { status, body } = await fetchText(`${shareBase}/redteam-console/api/console/engagements`)
    assert.equal(status, 200)
    assert.deepEqual(JSON.parse(body), ENGAGEMENTS_JSON)
    // The bearer was attached inside the Host process; the browser request
    // above carried no Authorization header at all.
    assert.equal(observed.authorization, `Bearer ${TOKEN}`)
    assert.ok(!body.includes(TOKEN), 'the response must not carry the token')
  })

  it('answers an Arsenal browse from a server-side tools/call', async () => {
    const { status, body } = await fetchText(`${shareBase}/redteam-console/arsenal`, {
      method: 'POST',
      body: JSON.stringify({ tool: 'arsenal_browse', arguments: {} }),
    })
    assert.equal(status, 200)
    assert.deepEqual(JSON.parse(body), { topics: [{ id: 'web', collections: 3 }] })
    assert.deepEqual(observed.mcpNames, ['arsenal_browse'])
  })

  it('refuses a non-allowlisted tool before anything reaches the console', async () => {
    const { status, body } = await fetchText(`${shareBase}/redteam-console/arsenal`, {
      method: 'POST',
      body: JSON.stringify({ tool: 'engagement_launch', arguments: {} }),
    })
    assert.equal(status, 400)
    assert.equal((JSON.parse(body) as { code: string }).code, 'bad-request')
    assert.deepEqual(observed.mcpNames, ['arsenal_browse'], 'no further /mcp call was made')
  })

  it('answers the connection rejection before any proxy work', async () => {
    rejection = 403
    try {
      const { status } = await fetchText(`${shareBase}/redteam-console/api/console/engagements`)
      assert.equal(status, 403)
    } finally {
      rejection = undefined
    }
  })

  it('removes the route registration when the plugin fiber disposes', async () => {
    const ctx = context!
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === '@secscan/redteam-console-share')
    assert.ok(entry?.fiber !== undefined, 'the console-share entry is mounted')
    await entry.fiber.dispose()
    // Registering the same prefix again must not collide: the disposed
    // plugin's registration is gone (registry disposal proof).
    const webServer = Reflect.get(ctx, 'webServer') as HttpServer
    const dispose = webServer.register({ kind: 'prefix', path: CONSOLE_SHARE_PREFIX_PATH, handler: () => {} })
    dispose()
  })
})
