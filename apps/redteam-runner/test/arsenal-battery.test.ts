/**
 * ARS-9 acceptance battery — §6.1.3 composition + §6.1.5 determinism.
 *
 * Boots the REAL console (startUiServer) against a fixture-built index
 * generation (spec §5 schema verbatim, generation 7) in a temp data home and
 * exercises the three arsenal tools over POST /mcp exactly as the fleet
 * would. No network leaves the loopback test server; the fixture index is
 * synthetic (see arsenal-battery-fixture.ts).
 *
 * Test names carry their §6.1 receipt number so the battery report maps
 * one-to-one onto the brief.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ARSENAL_EMPTY_FIX,
  ARSENAL_TOOL_NAMES,
  FIXTURE_BUILT_AT,
  FIXTURE_ENTRIES,
  FIXTURE_GENERATION,
  FIXTURE_SOURCE_COMMIT,
  buildFixtureIndex,
} from './arsenal-battery-fixture.js'

const ARSENAL_ENV_KEYS = [
  'REDTEAM_ARSENAL_ENABLED',
  'REDTEAM_ARSENAL_DB_PATH',
  'REDTEAM_ARSENAL_SOURCE_REPO',
  'REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS',
  'REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION',
  'REDTEAM_HOME',
]

interface JsonRpcResponse {
  jsonrpc?: string
  id?: unknown
  result?: {
    content?: Array<{ type: string; text: string }>
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
  }
  error?: { code: number; message: string }
}

interface SearchEnvelope {
  results: Array<{
    name: string
    url: string
    description: string
    description_truncated: boolean
    collection: string
    tags: string[]
    targets: string[]
    battery: string[]
    why?: string[]
  }>
  total: number
  index: { generation: number; built_at: string; source_commit: string }
}

let tmp = ''
let base = ''
let token = ''
let closeServer: (() => Promise<void>) | undefined
let arsenalModulePresent = false
let expectedNames: Set<string> = new Set()
let compositionCounts = { cockpitAndEngagement: -1, exec: -1 }
const savedEnv: Record<string, string | undefined> = {}

async function rpc(
  method: string,
  params: Record<string, unknown>,
  opts: { auth?: boolean; id?: number } = {},
): Promise<{ status: number; body: JsonRpcResponse; raw: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.auth !== false) headers['authorization'] = `Bearer ${token}`
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: opts.id ?? 1, method, params }),
  })
  const raw = await res.text()
  let body: JsonRpcResponse = {}
  try {
    body = JSON.parse(raw) as JsonRpcResponse
  } catch {
    /* body stays {} — assertions below name the failure */
  }
  return { status: res.status, body, raw }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<{ status: number; text: string; parsed: unknown }> {
  const { status, body } = await rpc('tools/call', { name, arguments: args })
  const text = body.result?.content?.[0]?.text ?? ''
  let parsed: unknown = undefined
  try {
    parsed = JSON.parse(text)
  } catch {
    /* assertions name it */
  }
  return { status, text, parsed }
}

function asSearchEnvelope(parsed: unknown): SearchEnvelope {
  assert.ok(parsed !== undefined && typeof parsed === 'object', 'tool result must be a JSON object')
  const env = parsed as SearchEnvelope
  assert.ok(Array.isArray(env.results), 'envelope.results must be an array')
  assert.equal(typeof env.total, 'number', 'envelope.total must be a number')
  assert.ok(env.index !== undefined, 'envelope.index must be present')
  return env
}

before(async () => {
  for (const k of ARSENAL_ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  tmp = mkdtempSync(join(tmpdir(), 'arsenal-battery-'))
  const { engagementsDir } = buildFixtureIndex(tmp)

  // Dynamic imports AFTER the env scrub: the endpoint resolves arsenal
  // config from process.env at module scope (brief §2), so import order is
  // part of the test setup, not an accident.
  const serverMod = await import('../src/ui/server.js')
  const toolsMod = await import('../src/ui/mcp-tools.js')
  const execMod = await import('../src/ui/mcp-exec.js')
  const arsenalSpec: string = '../src/arsenal/tools.js'
  let arsenalNames: string[] = []
  try {
    const arsenalMod = (await import(arsenalSpec)) as { ARSENAL_TOOLS?: Array<{ name: string }> }
    if (Array.isArray(arsenalMod.ARSENAL_TOOLS)) {
      arsenalModulePresent = true
      arsenalNames = arsenalMod.ARSENAL_TOOLS.map(t => t.name)
    }
  } catch {
    arsenalModulePresent = false
  }
  expectedNames = new Set([
    ...toolsMod.TOOLS.map((t: { name: string }) => t.name),
    execMod.LIST_LIVE_TOOL.name,
    ...execMod.EXEC_TOOLS.map((t: { name: string }) => t.name),
    ...arsenalNames,
  ])
  compositionCounts = {
    cockpitAndEngagement: toolsMod.TOOLS.length,
    exec: execMod.EXEC_TOOLS.length,
  }

  const srv = await serverMod.startUiServer({ port: 0, engagementsDir })
  token = srv.token
  base = `http://127.0.0.1:${srv.port}`
  closeServer = srv.close
})

after(async () => {
  if (closeServer) await closeServer()
  for (const k of ARSENAL_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  if (tmp) { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) } catch { /* Windows: a live DB handle can pin the temp dir */ } }
})

describe('§6.1.3 real-composition boot (fixture index)', () => {
  it('arsenal tools module is landed (src/arsenal/tools.ts)', () => {
    assert.ok(
      arsenalModulePresent,
      'src/arsenal/tools.ts must export ARSENAL_TOOLS (ARS-5 slice not landed or export missing)',
    )
  })

  it('§6.1.3 pre-existing composition counts are 17 cockpit+engagement and 27 exec', () => {
    // 17, not 16: HEAD composes COCKPIT_TOOLS + ENGAGEMENT_TOOLS + LOCAL_TOOLS,
    // and LOCAL_TOOLS contributes `engagement_launch_local` (the local-host
    // engagement). The pin predated that feature; the tool is intentional and
    // present at HEAD, so the baseline is re-stated with it named rather than
    // silently loosened.
    assert.equal(compositionCounts.cockpitAndEngagement, 17, 'TOOLS (cockpit + engagement + local) must be 17 before arsenal')
    assert.equal(compositionCounts.exec, 27, 'EXEC_TOOLS must be 27 before arsenal')
  })

  it('§6.1.3 tools/list equals the in-process composition plus exactly the three arsenal tools', async () => {
    const { status, body } = await rpc('tools/list', {})
    assert.equal(status, 200)
    const listed = body.result?.tools ?? []
    const listedNames = listed.map(t => t.name)
    assert.deepEqual(new Set(listedNames), expectedNames, 'tools/list must equal the composed set — no more, no less')
    assert.equal(listedNames.length, expectedNames.size, 'tools/list must not contain duplicates')
    for (const name of ARSENAL_TOOL_NAMES) {
      assert.equal(listedNames.filter(n => n === name).length, 1, `${name} must appear exactly once`)
    }
  })

  it('§6.1.3 every arsenal schema carries additionalProperties: false', async () => {
    const { body } = await rpc('tools/list', {})
    const listed = body.result?.tools ?? []
    for (const name of ARSENAL_TOOL_NAMES) {
      const tool = listed.find(t => t.name === name)
      assert.ok(tool, `${name} must be listed`)
      assert.equal(
        (tool.inputSchema as { additionalProperties?: unknown } | undefined)?.additionalProperties,
        false,
        `${name} inputSchema.additionalProperties must be false`,
      )
    }
  })

  it('§6.1.3 unauthenticated tools/call returns HTTP 401 with a parseable -32001 body', async () => {
    const { status, body, raw } = await rpc('tools/call', { name: 'arsenal_search', arguments: { query: 'ssrf' } }, { auth: false })
    assert.equal(status, 401, 'unauthenticated call must be HTTP 401')
    assert.ok(raw.length > 0, '401 body must be present and parseable')
    assert.equal(body.error?.code, -32001, '401 body must carry the JSON-RPC -32001 error')
  })
})

describe('§6.1.3/§7 search behaviour over the fixture generation', () => {
  it('known query returns the known entry first', async () => {
    const { parsed } = await callTool('arsenal_search', { query: 'ssrf' })
    const env = asSearchEnvelope(parsed)
    assert.ok(env.results.length >= 1, 'ssrf must match the fixture SSRF entry')
    assert.equal(env.results[0]?.name, 'SSRF Payloads')
  })

  it('envelope carries the fixture generation stamp (stored, not assumed)', async () => {
    const { parsed } = await callTool('arsenal_search', { query: 'ssrf' })
    const env = asSearchEnvelope(parsed)
    assert.equal(env.index.generation, FIXTURE_GENERATION)
    assert.equal(env.index.source_commit, FIXTURE_SOURCE_COMMIT)
    assert.equal(env.index.built_at, FIXTURE_BUILT_AT)
  })

  it('target facet filter excludes rows without the target', async () => {
    const none = asSearchEnvelope((await callTool('arsenal_search', { query: 'wordlist', target: 'LX' })).parsed)
    assert.equal(none.total, 0, 'no wordlist fixture entry carries LX')
    const some = asSearchEnvelope((await callTool('arsenal_search', { query: 'sudo', target: 'LX' })).parsed)
    assert.ok(some.results.some(r => r.name === 'sudo'), 'the LX sudo entry must survive the LX filter')
    for (const r of some.results) assert.ok(r.targets.includes('LX'), 'every filtered result must carry the target')
  })

  it('battery facet filter returns only entries carrying the item id', async () => {
    const env = asSearchEnvelope((await callTool('arsenal_search', { query: 'payloads', battery: 'F-9' })).parsed)
    assert.ok(env.results.length >= 1)
    assert.equal(env.results[0]?.name, 'SSRF Payloads')
    for (const r of env.results) assert.ok(r.battery.includes('F-9'), 'every result must carry F-9')
  })

  it('category accepts a collection slug and scopes results to it', async () => {
    const env = asSearchEnvelope((await callTool('arsenal_search', { query: 'wordlist', category: 'seclists' })).parsed)
    assert.ok(env.total >= 2, 'both seclists wordlist entries must match')
    for (const r of env.results) assert.equal(r.collection, 'seclists')
  })

  it('unknown category returns total 0 with the envelope, not an error', async () => {
    const { parsed } = await callTool('arsenal_search', { query: 'wordlist', category: 'no-such-topic' })
    const env = asSearchEnvelope(parsed)
    assert.equal(env.total, 0)
    assert.equal(env.results.length, 0)
    assert.equal(env.index.generation, FIXTURE_GENERATION)
  })

  it('limit 500 clamps to 50 while total reports the full match count', async () => {
    const env = asSearchEnvelope((await callTool('arsenal_search', { query: 'bulk', limit: 500 })).parsed)
    assert.equal(env.total, 60)
    assert.equal(env.results.length, 50, 'results must clamp at the §7.1 max of 50')
  })

  it('default limit is 10', async () => {
    const env = asSearchEnvelope((await callTool('arsenal_search', { query: 'bulk' })).parsed)
    assert.equal(env.total, 60)
    assert.equal(env.results.length, 10)
  })

  it('descriptions truncate at 280 chars with description_truncated set', async () => {
    const env = asSearchEnvelope((await callTool('arsenal_search', { query: 'username' })).parsed)
    const hit = env.results.find(r => r.name === 'Comprehensive Username List')
    assert.ok(hit, 'the long-description fixture entry must be found')
    const fixture = FIXTURE_ENTRIES.find(e => e.name === 'Comprehensive Username List')
    assert.ok(fixture && fixture.description.length > 280, 'fixture description must exceed 280 chars (fixture self-check)')
    assert.equal(hit.description.length, 280)
    assert.equal(hit.description_truncated, true)
  })

  it('ranking sanity: a name match outranks a description-only match (name x3)', async () => {
    const env = asSearchEnvelope((await callTool('arsenal_search', { query: 'kubernetes' })).parsed)
    assert.ok(env.results.length >= 2, 'both kubernetes fixture entries must match')
    assert.equal(env.results[0]?.name, 'Kubernetes Secrets', 'the name-match entry must rank first')
    assert.ok(env.results.some(r => r.name === 'Cluster Enumeration Notes'), 'the description-match entry must be present')
  })

  it('FTS operator input is literal data, never syntax', async () => {
    for (const q of ['*', 'NEAR(', '"']) {
      const { parsed } = await callTool('arsenal_search', { query: q })
      const env = asSearchEnvelope(parsed)
      assert.equal(env.total, 0, `query ${JSON.stringify(q)} must match nothing in the fixture corpus`)
    }
    const orEnv = asSearchEnvelope((await callTool('arsenal_search', { query: 'OR' })).parsed)
    assert.ok(
      orEnv.results.some(r => r.name === 'Fuzzing Strings'),
      "the literal token 'or' must match the entry whose description contains it — operators never execute",
    )
    const nul = await callTool('arsenal_search', { query: 'bulk\u0000zz' })
    assert.ok(nul.parsed !== undefined, 'a NUL-bearing query must still yield a JSON answer, not a crash')
  })
})

describe('§6.1.5 determinism (byte-equality)', () => {
  it('identical search twice returns byte-identical response JSON', async () => {
    const a = await callTool('arsenal_search', { query: 'bulk', limit: 50 })
    const b = await callTool('arsenal_search', { query: 'bulk', limit: 50 })
    // Precondition: the calls must be real answers, not identical error
    // strings — byte-equality of two failures proves nothing.
    assert.equal(asSearchEnvelope(a.parsed).total, 60, 'determinism precondition: the search must really answer')
    assert.equal(a.text, b.text, 'two identical searches against one generation must be byte-identical')
  })

  it('identical recommend twice returns byte-identical response JSON', async () => {
    const args = { task: 'Forge a JWT to bypass the login form' }
    const a = await callTool('arsenal_recommend', args)
    const b = await callTool('arsenal_recommend', args)
    assert.ok(
      Array.isArray(asSearchEnvelope(a.parsed).results),
      'determinism precondition: the recommend must really answer with results',
    )
    assert.equal(a.text, b.text)
  })
})

describe('browse honesty — Level-2 claims match stored content', () => {
  it('topic census reports stored collection and entry counts', async () => {
    const { parsed } = await callTool('arsenal_browse', {})
    const browse = parsed as { topics?: Array<{ topic: string; collections: number; entries: number }> }
    assert.ok(Array.isArray(browse.topics), 'browse without category must return the topic census')
    const topics = browse.topics ?? []
    const osint = topics.find(t => t.topic === 'OSINT')
    assert.ok(osint, 'OSINT topic must be in the census')
    assert.equal(osint.collections, 1)
    assert.equal(osint.entries, 0)
    const wordlists = topics.find(t => t.topic === 'Wordlists')
    assert.ok(wordlists)
    assert.equal(wordlists.collections, 1)
    assert.equal(wordlists.entries, 4)
  })

  it('level2 flag is false exactly when the collection was never Level-2 ingested', async () => {
    const l1 = (await callTool('arsenal_browse', { category: 'OSINT' })).parsed as {
      collections?: Array<{ slug: string; entry_count: number; level2: boolean }>
    }
    assert.ok(Array.isArray(l1.collections))
    const osint = (l1.collections ?? []).find(c => c.slug === 'awesome-osint')
    assert.ok(osint)
    assert.equal(osint.level2, false, 'fetched_at NULL + entry_count 0 must surface as level2: false')
    assert.equal(osint.entry_count, 0)

    const l2 = (await callTool('arsenal_browse', { category: 'Wordlists' })).parsed as {
      collections?: Array<{ slug: string; entry_count: number; level2: boolean }>
    }
    const seclists = (l2.collections ?? []).find(c => c.slug === 'seclists')
    assert.ok(seclists)
    assert.equal(seclists.level2, true)
    assert.equal(seclists.entry_count, 4)
  })
})

describe('recommend — explainable, rule-derived facets', () => {
  it('a JWT task surfaces the JWT entry with why containing battery:F-10', async () => {
    const env = asSearchEnvelope((await callTool('arsenal_recommend', { task: 'Forge a JWT to bypass the login form' })).parsed)
    const hit = env.results.find(r => r.name === 'JWT Wordlist')
    assert.ok(hit, 'the JWT fixture entry must be recommended for a JWT task')
    assert.ok(Array.isArray(hit.why), 'recommend results must carry a why array')
    assert.ok((hit.why ?? []).includes('battery:F-10'), 'why must name the spec-pinned jwt→F-10 rule facet')
  })

  it('every why facet uses the documented prefix discipline', async () => {
    const env = asSearchEnvelope(
      (await callTool('arsenal_recommend', { task: 'SSRF against the cloud metadata endpoint from a Linux host' })).parsed,
    )
    for (const r of env.results) {
      for (const facet of r.why ?? []) {
        assert.match(facet, /^(battery|target|tag|topic|collection):/, `why facet ${JSON.stringify(facet)} must be prefix-typed`)
      }
    }
  })

  it('empty-fix constant matches the §7.1 fix string (battery self-check)', () => {
    assert.equal(ARSENAL_EMPTY_FIX, 'Run: redteam-runner arsenal refresh')
  })
})
