/**
 * ARS-9 acceptance battery — §6.1.3 disabled mode.
 *
 * With REDTEAM_ARSENAL_ENABLED=0 set BEFORE any console module loads (the
 * endpoint resolves arsenal config from process.env at module scope, brief
 * §2), the three arsenal tools must be ABSENT from tools/list — not stubs,
 * not errors — even though a valid fixture index exists on disk. A call to
 * one must meet the endpoint's unknown-tool error.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ARSENAL_TOOL_NAMES, buildFixtureIndex } from './arsenal-battery-fixture.js'

let tmp = ''
let base = ''
let token = ''
let closeServer: (() => Promise<void>) | undefined
let savedEnabled: string | undefined
let savedDbPath: string | undefined
let preExistingCount = -1

before(async () => {
  savedEnabled = process.env['REDTEAM_ARSENAL_ENABLED']
  savedDbPath = process.env['REDTEAM_ARSENAL_DB_PATH']
  process.env['REDTEAM_ARSENAL_ENABLED'] = '0'
  delete process.env['REDTEAM_ARSENAL_DB_PATH']

  tmp = mkdtempSync(join(tmpdir(), 'arsenal-battery-disabled-'))
  const { engagementsDir } = buildFixtureIndex(tmp)

  // Import after the env is set — module-scope config resolution is the
  // behaviour under test.
  const serverMod = await import('../src/ui/server.js')
  const toolsMod = await import('../src/ui/mcp-tools.js')
  const execMod = await import('../src/ui/mcp-exec.js')
  preExistingCount = toolsMod.TOOLS.length + execMod.EXEC_TOOLS.length + 1 // + LIST_LIVE_TOOL

  const srv = await serverMod.startUiServer({ port: 0, engagementsDir })
  token = srv.token
  base = `http://127.0.0.1:${srv.port}`
  closeServer = srv.close
})

after(async () => {
  if (closeServer) await closeServer()
  if (savedEnabled === undefined) delete process.env['REDTEAM_ARSENAL_ENABLED']
  else process.env['REDTEAM_ARSENAL_ENABLED'] = savedEnabled
  if (savedDbPath === undefined) delete process.env['REDTEAM_ARSENAL_DB_PATH']
  else process.env['REDTEAM_ARSENAL_DB_PATH'] = savedDbPath
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

describe('§6.1.3 disabled mode (REDTEAM_ARSENAL_ENABLED=0)', () => {
  it('the arsenal slice is landed (so absence below means disabled, not missing)', () => {
    const toolsSource = fileURLToPath(new URL('../../src/arsenal/tools.ts', import.meta.url))
    assert.ok(
      existsSync(toolsSource),
      "src/arsenal/tools.ts must exist — without it this file's absence assertions would pass vacuously (ARS-5 slice)",
    )
  })

  it('the three arsenal tools are absent from tools/list, pre-existing tools untouched', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { result?: { tools?: Array<{ name: string }> } }
    const names = (body.result?.tools ?? []).map(t => t.name)
    for (const name of ARSENAL_TOOL_NAMES) {
      assert.ok(!names.includes(name), `${name} must be absent when arsenal is disabled — not a stub`)
    }
    assert.equal(names.length, preExistingCount, 'the pre-existing composition must be listed unchanged')
  })

  it('tools/call on a disabled arsenal tool meets the unknown-tool error (-32602)', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'arsenal_search', arguments: { query: 'ssrf' } },
      }),
    })
    const body = (await res.json()) as { error?: { code: number }; result?: { isError?: boolean } }
    assert.equal(body.error?.code, -32602, 'a disabled tool must be indistinguishable from an unknown tool')
  })
})
