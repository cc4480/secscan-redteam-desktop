/**
 * ARS-9 acceptance battery — §6.1.4 empty-index typed result.
 *
 * Boots the real console against a FRESH temp data home (no arsenal.db
 * anywhere) and asserts: all three arsenal tools return the typed
 * ARSENAL_INDEX_EMPTY block carrying the §7.1 fix string; the console
 * otherwise serves normally; and the readiness surface reports the
 * arsenal_index item as not-ready with the same fix (ARS-8's Step 7 item —
 * asserted state-agnostically because ReadinessState has no 'warn' literal;
 * see the ARS-9 crew-log note).
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ARSENAL_EMPTY_FIX, ARSENAL_TOOL_NAMES } from './arsenal-battery-fixture.js'

const ARSENAL_ENV_KEYS = [
  'REDTEAM_ARSENAL_ENABLED',
  'REDTEAM_ARSENAL_DB_PATH',
  'REDTEAM_ARSENAL_SOURCE_REPO',
  'REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS',
  'REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION',
]

let tmp = ''
let base = ''
let token = ''
let closeServer: (() => Promise<void>) | undefined
let savedHome: string | undefined
const savedEnv: Record<string, string | undefined> = {}

interface RpcBody {
  result?: { content?: Array<{ text: string }>; tools?: Array<{ name: string }> }
  error?: { code: number; message: string }
}

async function rpc(method: string, params: Record<string, unknown>): Promise<{ status: number; body: RpcBody }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const raw = await res.text()
  let body: RpcBody = {}
  try {
    body = JSON.parse(raw) as RpcBody
  } catch {
    /* assertions name it */
  }
  return { status: res.status, body }
}

before(async () => {
  for (const k of ARSENAL_ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  savedHome = process.env['REDTEAM_HOME']
  tmp = mkdtempSync(join(tmpdir(), 'arsenal-battery-empty-'))
  const engagementsDir = join(tmp, 'engagements', 'live')
  mkdirSync(engagementsDir, { recursive: true })
  // Point the REDTEAM_HOME derivation at the empty home so any readiness /
  // config derivation sees the same emptiness the console sees.
  process.env['REDTEAM_HOME'] = tmp

  const serverMod = await import('../src/ui/server.js')
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
  if (savedHome === undefined) delete process.env['REDTEAM_HOME']
  else process.env['REDTEAM_HOME'] = savedHome
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

describe('§6.1.4 empty-index typed result', () => {
  it('console serves normally with no index (tools/list answers, arsenal tools registered)', async () => {
    const { status, body } = await rpc('tools/list', {})
    assert.equal(status, 200)
    const names = (body.result?.tools ?? []).map(t => t.name)
    assert.ok(names.includes('engagement_launch'), 'pre-existing tools must still be listed')
    for (const name of ARSENAL_TOOL_NAMES) {
      assert.ok(names.includes(name), `${name} must be registered even with an empty index (ARS-5 slice)`)
    }
  })

  for (const [tool, args] of [
    ['arsenal_search', { query: 'anything' }],
    ['arsenal_browse', {}],
    ['arsenal_recommend', { task: 'anything' }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`${tool} returns the ARSENAL_INDEX_EMPTY block with the fix string`, async () => {
      const { status, body } = await rpc('tools/call', { name: tool, arguments: args })
      assert.equal(status, 200, 'empty index is a typed result, not a transport error')
      const text = body.result?.content?.[0]?.text ?? ''
      let parsed: { error?: { code?: string; fix?: string } } = {}
      try {
        parsed = JSON.parse(text) as typeof parsed
      } catch {
        assert.fail(`${tool} empty-index result must be JSON, got: ${text.slice(0, 120)}`)
      }
      assert.equal(parsed.error?.code, 'ARSENAL_INDEX_EMPTY', `${tool} must return the typed empty block`)
      assert.equal(parsed.error?.fix, ARSENAL_EMPTY_FIX, `${tool} must carry the §7.1 fix string verbatim`)
    })
  }

  it('readiness reports arsenal_index as not-ready with the same fix (ARS-8 item)', async () => {
    const { readinessReport } = await import('../src/tools/readiness.js')
    const report = await readinessReport({ ...process.env })
    const item = report.items.find(i => i.id === 'arsenal_index')
    assert.ok(item, 'readiness must carry the arsenal_index item (ARS-8 Step 7 slice not landed or item missing)')
    assert.notEqual(item.state, 'ready', 'with no index built, arsenal_index must not read ready')
    const fixText = `${item.fix ?? ''}\n${item.detail ?? ''}`
    assert.ok(
      fixText.includes(ARSENAL_EMPTY_FIX),
      `arsenal_index must carry the §7.1 fix text; got fix=${JSON.stringify(item.fix)} detail=${JSON.stringify(item.detail)}`,
    )
  })
})
