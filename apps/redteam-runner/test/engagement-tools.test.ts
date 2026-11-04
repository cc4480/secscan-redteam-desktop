/**
 * Chat engagement tools (v0.31.0).
 *
 * The trio a chat agent uses to fulfil a scan request end to end:
 * engagement_launch / engagement_status / engagement_report. Covered here:
 * the surface (registered once, never shadowing executor tools), the
 * conversation-shaped launch body (punctuation cleaning, host-derived
 * scope, the named operator the authorize attestation consumes), refusal
 * paths that launch nothing, and the status/report shapes against canned
 * engagement records. The live round-trip is proven separately against a
 * real server; nothing here starts a real engagement.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UiStore } from '../src/ui/store.js'
import { authorizePhase } from '../src/phases/authorize.js'
import { scopeGuardFor } from '../src/safety/scope-guard.js'
import type { Ctx } from '../src/context.js'
import { TOOLS, TOOLS_BY_NAME } from '../src/ui/mcp-tools.js'
import { EXEC_TOOLS } from '../src/ui/mcp-exec.js'
import { ENGAGEMENT_TOOLS, buildLaunchBody, cleanTarget, targetHost } from '../src/ui/engagement-tools.js'
import { startUiServer } from '../src/ui/server.js'

let tmp = ''
let store: UiStore

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'eng-tools-test-'))
  store = new UiStore(tmp)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const tool = (name: string) => {
  const t = TOOLS_BY_NAME.get(name)
  assert.ok(t, `tool ${name} is registered`)
  return t
}

async function rpc(base: string, token: string, method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  })
  return (await res.json()) as Record<string, unknown>
}

function cannedState(id: string, status: string, withReport: boolean, extra: Record<string, unknown> = {}): string {
  const dir = join(tmp, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      engagementId: id,
      target: 'https://example.com',
      mode: 'red',
      objective: 'test',
      status,
      phase: status === 'complete' ? 'report' : 'exploit',
      ...extra,
      verified: true,
      verificationProof: 'Operator-attested ownership: the desktop user attests on the engagement record',
      findings: [
        { id: 'F-1', severity: 'high', title: 'SQLi in search', attackIds: ['T1190'], status: 'confirmed', tier: 1, target: 'example.com' },
        { id: 'F-2', severity: 'low', title: 'Verbose banner', attackIds: [], status: 'confirmed', tier: 0, target: 'example.com' },
      ],
      eventCount: 42,
      startedAt: '2026-10-28T10:00:00Z',
      updatedAt: '2026-10-28T10:05:00Z',
    }),
  )
  if (withReport) writeFileSync(join(dir, 'report.md'), '# Engagement report\n\nGrade: A\n')
  return dir
}

describe('tool surface', () => {
  it('registers the quartet once, alongside the CLI-shaped tools', () => {
    assert.equal(ENGAGEMENT_TOOLS.length, 4)
    for (const name of ['engagement_launch', 'engagement_status', 'engagement_report', 'engagement_regenerate_report']) {
      assert.ok(TOOLS_BY_NAME.has(name), `${name} in TOOLS_BY_NAME`)
      assert.equal(TOOLS.filter(t => t.name === name).length, 1, `${name} appears exactly once`)
    }
  })

  it('never shadows an executor tool name', () => {
    const execNames = new Set(EXEC_TOOLS.map(t => t.name))
    for (const t of ENGAGEMENT_TOOLS) assert.ok(!execNames.has(t.name), `${t.name} is cockpit-owned`)
  })
})

describe('launch body building', () => {
  it("cleans the trailing-comma target that defeated the keeper's first launch", () => {
    assert.equal(cleanTarget('https://secscan.us,'), 'https://secscan.us')
    assert.equal(cleanTarget('  "https://secscan.us". '), 'https://secscan.us')
    assert.equal(cleanTarget('https://example.com:8443/a,b'), 'https://example.com:8443/a,b')
  })

  it('reads hosts from URLs and bare hosts alike', () => {
    assert.equal(targetHost('https://secscan.us/path?q=1'), 'secscan.us')
    assert.equal(targetHost('secscan.us'), 'secscan.us')
    assert.equal(targetHost('secscan.us:8443'), 'secscan.us')
    assert.equal(targetHost('not a target!!'), null)
  })

  it('derives a single-host scope and defaults mode to red', () => {
    const built = buildLaunchBody({ target: 'https://secscan.us,', objective: 'full deep scan' })
    assert.ok('body' in built)
    if (!('body' in built)) return
    assert.equal(built.body.target, 'https://secscan.us')
    assert.deepEqual(built.body.scope, ['secscan.us'])
    assert.equal(built.body.mode, 'red')
  })

  it('names the operator so authorize attests from the record', () => {
    const named = buildLaunchBody({ target: 'secscan.us', objective: 'scan', operatorName: 'Carlos' })
    assert.ok('body' in named && named.body.operatorName === 'Carlos')
    const fallback = buildLaunchBody({ target: 'secscan.us', objective: 'scan' })
    // A real identity, never the old placeholder.
    assert.ok('body' in fallback)
    if (!('body' in fallback)) return
    assert.notEqual(fallback.body.operatorName, 'the desktop user')
    assert.ok((fallback.body.operatorName ?? '').trim().length > 0, 'no identity was recorded')
    const clientOnly = buildLaunchBody({ target: 'secscan.us', objective: 'scan', client: 'Acme' })
    assert.ok('body' in clientOnly && clientOnly.body.operatorName === undefined && clientOnly.body.client === 'Acme')
  })

  it('keeps an explicit scope and refuses what it cannot shape', () => {
    const scoped = buildLaunchBody({ target: 'https://a.example.com', objective: 'scan', scope: ['a.example.com', 'b.example.com'] })
    assert.ok('body' in scoped && scoped.body.scope.length === 2)
    assert.ok('error' in buildLaunchBody({ objective: 'scan' }), 'target required')
    assert.ok('error' in buildLaunchBody({ target: 'secscan.us' }), 'objective required')
    assert.ok('error' in buildLaunchBody({ target: 'not a target!!', objective: 'scan' }), 'host required')
  })
})

describe('engagement_launch refusals', () => {
  it('returns 400 and launches nothing for an unshapeable target', async () => {
    const out = await tool('engagement_launch').run(store, { target: 'not a target!!', objective: 'scan it' })
    assert.equal(out.status, 400)
    assert.equal(store.list().length, 0)
  })

  it('ignores a malformed explicit scope instead of launching with it', async () => {
    // A blank-string scope fails the builder's shape check and falls back
    // to the derived host; with an unshapeable target alongside, nothing
    // launches at all.
    const built = buildLaunchBody({ target: 'https://example.com', objective: 'scan', scope: [''] })
    assert.ok('body' in built)
    if ('body' in built) assert.deepEqual(built.body.scope, ['example.com'])
    const out = await tool('engagement_launch').run(store, { target: '', objective: 'scan', scope: [''] })
    assert.equal(out.status, 400)
    assert.equal(store.list().length, 0)
  })
})

describe('engagement_status', () => {
  it('reshapes a completed engagement for narration', async () => {
    cannedState('eng-2026-10-28-aaaa', 'complete', true)
    const out = await tool('engagement_status').run(store, { id: 'eng-2026-10-28-aaaa' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['status'], 'complete')
    assert.equal(b['phase'], 'report')
    assert.equal(b['findings'], 2)
    assert.equal(b['eventCount'], 42)
    assert.equal(b['verified'], true)
    assert.match(String(b['summary']), /complete: 2 findings over 42 events/)
  })

  it('prompts report delivery on a halted end whose deliverables did not fail (S6-H4a)', async () => {
    cannedState('eng-2026-10-28-h4a1', 'halted', true, { blockedReason: 'coordinator withheld sign-off' })
    const out = await tool('engagement_status').run(store, { id: 'eng-2026-10-28-h4a1' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['status'], 'halted')
    assert.equal(
      b['summary'],
      'Engagement eng-2026-10-28-h4a1 halted: coordinator withheld sign-off. 2 findings recorded. Call engagement_report to deliver the report.',
    )
  })

  it('prompts report delivery on a blocked end whose deliverables did not fail (S6-H4a)', async () => {
    cannedState('eng-2026-10-28-h4a2', 'blocked', true, { blockedReason: 'ownership not verified' })
    const out = await tool('engagement_status').run(store, { id: 'eng-2026-10-28-h4a2' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['status'], 'blocked')
    assert.equal(
      b['summary'],
      'Engagement eng-2026-10-28-h4a2 blocked: ownership not verified. 2 findings recorded. Call engagement_report to deliver the report.',
    )
  })

  it('keeps the regenerate pointer and no delivery prompt on a deliverable-failed halted end (S6-H4a guard)', async () => {
    cannedState('eng-2026-10-28-h4a3', 'halted', true, { blockedReason: 'router exploded', deliverableFailed: true })
    const out = await tool('engagement_status').run(store, { id: 'eng-2026-10-28-h4a3' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['deliverableFailed'], true)
    assert.match(String(b['summary']), /Deliverable set INCOMPLETE — missing: /)
    assert.match(String(b['summary']), /Call engagement_regenerate_report to re-fire report generation\./)
    assert.ok(!String(b['summary']).includes('Call engagement_report to deliver the report.'))
  })

  it('keeps the complete summary byte-identical (S6-H4a guard)', async () => {
    cannedState('eng-2026-10-28-h4a4', 'complete', true)
    const out = await tool('engagement_status').run(store, { id: 'eng-2026-10-28-h4a4' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(
      b['summary'],
      'Engagement eng-2026-10-28-h4a4 is complete: 2 findings over 42 events. Call engagement_report to deliver the report.',
    )
  })

  it('surfaces the halt reason for a run that died before writing state', async () => {
    store.register({
      id: 'eng-2026-10-28-bbbb',
      dir: join(tmp, 'eng-2026-10-28-bbbb'),
      status: 'halted',
      startedAt: '2026-10-28T10:00:00Z',
      target: 'https://example.com',
      mode: 'red',
      error: 'No model provider key is configured. Set MODEL_API_KEY (Meta) or DEEPSEEK_API_KEY.',
    })
    const out = await tool('engagement_status').run(store, { id: 'eng-2026-10-28-bbbb' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['status'], 'halted')
    assert.equal(b['phase'], 'starting')
    assert.match(String(b['summary']), /halted before it started/)
  })

  it('404s an unknown id', async () => {
    const out = await tool('engagement_status').run(store, { id: 'eng-2026-10-28-zzzz' })
    assert.equal(out.status, 404)
  })
})

describe('engagement_report', () => {
  it('returns the report content and in-app path once finished', async () => {
    const dir = cannedState('eng-2026-10-28-cccc', 'complete', true)
    const out = await tool('engagement_report').run(store, { id: 'eng-2026-10-28-cccc' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['ready'], true)
    assert.match(String(b['content']), /# Engagement report/)
    assert.equal(b['reportPath'], join(dir, 'report.md'))
  })

  it('carries the recorded status on a ready halted report (S2-H10)', async () => {
    cannedState('eng-2026-10-28-hh10', 'halted', true)
    const out = await tool('engagement_report').run(store, { id: 'eng-2026-10-28-hh10' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['ready'], true)
    assert.equal(b['status'], 'halted')
  })

  it('carries the recorded status on a ready complete report (S2-H10)', async () => {
    cannedState('eng-2026-10-28-cc10', 'complete', true)
    const out = await tool('engagement_report').run(store, { id: 'eng-2026-10-28-cc10' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['ready'], true)
    assert.equal(b['status'], 'complete')
  })

  it('carries the Scribe signoff on a ready signed report (S6-H2a)', async () => {
    cannedState('eng-2026-10-28-sgnd', 'complete', true, {
      artifactSignoff: { by: 'scribe', at: '2026-10-28T10:06:00Z', cycles: 2 },
      artifactUnsigned: null,
    })
    const out = await tool('engagement_report').run(store, { id: 'eng-2026-10-28-sgnd' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['ready'], true)
    assert.deepEqual(b['signoff'], { signed: true, cycles: 2 })
  })

  it('carries the unsigned outcome on a ready unsigned report (S6-H2a)', async () => {
    cannedState('eng-2026-10-28-unsg', 'complete', true, {
      artifactSignoff: null,
      artifactUnsigned: {
        reason: 'defects',
        defects: [
          { file: 'report.html', class: 'craft', detail: 'Grade cell empty', fix: 'Render the grade' },
          { file: 'report.md', class: 'completeness', detail: 'Missing fix section', fix: 'Add the section' },
        ],
        cycles: 3,
        at: '2026-10-28T10:06:00Z',
      },
    })
    const out = await tool('engagement_report').run(store, { id: 'eng-2026-10-28-unsg' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['ready'], true)
    assert.deepEqual(b['signoff'], { signed: false, cycles: 3, reason: 'defects', defectCount: 2 })
  })

  it('carries no signoff field when no Scribe stamp was recorded (S6-H2a)', async () => {
    cannedState('eng-2026-10-28-nost', 'complete', true)
    const out = await tool('engagement_report').run(store, { id: 'eng-2026-10-28-nost' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['ready'], true)
    assert.equal('signoff' in b, false)
  })

  it('says ready:false while the run is still going', async () => {
    const dir = cannedState('eng-2026-10-28-dddd', 'running', false)
    // Still going means a live record behind it: without one, a
    // non-terminal record is a dead run and the answer names the repair
    // tool instead (S6-H5, covered in report-regenerate.test.ts).
    store.register({ id: 'eng-2026-10-28-dddd', dir, status: 'running', startedAt: '2026-10-28T10:00:00Z' })
    const out = await tool('engagement_report').run(store, { id: 'eng-2026-10-28-dddd' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.equal(b['ready'], false)
    assert.equal(b['status'], 'running')
    assert.match(String(b['summary']), /Keep polling/)
  })

  it('404s an unknown id', async () => {
    const out = await tool('engagement_report').run(store, { id: 'eng-2026-10-28-yyyy' })
    assert.equal(out.status, 404)
  })
})

/** Write an events.jsonl beside a canned state, in the EventLog's shape. */
function cannedEvents(id: string, events: Array<Record<string, unknown>>): void {
  writeFileSync(
    join(tmp, id, 'events.jsonl'),
    events.map(e => JSON.stringify({ ts: '2026-10-28T10:01:00Z', engagementId: id, result: '', ...e })).join('\n') + '\n',
  )
}

describe('speaker stamps', () => {
  it('names the seat that executed most recently on engagement_status', async () => {
    cannedState('eng-2026-10-28-spe1', 'running', false)
    cannedEvents('eng-2026-10-28-spe1', [
      { seq: 1, phase: 'plan', actor: 'coordinator', action: 'reasoning' },
      { seq: 2, phase: 'exploit', actor: 'exploiter', action: 'reasoning' },
      { seq: 3, phase: 'exploit', actor: 'runner', action: 'tool_repair' },
    ])
    const out = await tool('engagement_status').run(store, { id: 'eng-2026-10-28-spe1' })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.deepEqual(b['speaker'], { name: 'NEO', role: 'exploiter' })
  })

  it('adds no speaker keys when the record names no seat', async () => {
    cannedState('eng-2026-10-28-spe2', 'complete', true)
    const out = await tool('engagement_status').run(store, { id: 'eng-2026-10-28-spe2' })
    const b = out.body as Record<string, unknown>
    assert.equal('speaker' in b, false)
    assert.equal('findingSpeakers' in b, false)
  })

  it('names the report author and per-finding producers on engagement_report', async () => {
    const id = 'eng-2026-10-28-spe3'
    cannedState(id, 'complete', true)
    cannedEvents(id, [
      { seq: 1, phase: 'exploit', actor: 'exploiter', action: 'reasoning' },
      { seq: 2, phase: 'report', actor: 'reporter', action: 'reasoning' },
    ])
    writeFileSync(
      join(tmp, id, 'report.json'),
      JSON.stringify({
        findings: [
          { id: 'F-1', producer: 'exploiter' },
          { id: 'F-2', producer: 'runner' },
          { id: 'F-3' },
        ],
      }),
    )
    const out = await tool('engagement_report').run(store, { id })
    assert.equal(out.status, 200)
    const b = out.body as Record<string, unknown>
    assert.deepEqual(b['speaker'], { name: 'ARCHITECT', role: 'reporter' })
    assert.deepEqual(b['findingSpeakers'], { 'F-1': { name: 'NEO', role: 'exploiter' } })
  })

  it('names no report author when the reporter loop never ran (mechanical end)', async () => {
    const id = 'eng-2026-10-28-spe4'
    cannedState(id, 'complete', true)
    cannedEvents(id, [{ seq: 1, phase: 'report', actor: 'runner', action: 'report_grade' }])
    const out = await tool('engagement_report').run(store, { id })
    const b = out.body as Record<string, unknown>
    assert.equal('speaker' in b, false)
  })

  it('rides the stamp as structuredContent over /mcp, and only when stamped', async () => {
    cannedState('eng-2026-10-28-spe5', 'running', false)
    cannedEvents('eng-2026-10-28-spe5', [
      { seq: 1, phase: 'recon', actor: 'recon', action: 'reasoning' },
    ])
    cannedState('eng-2026-10-28-spe6', 'running', false)
    const srv = await startUiServer({ port: 0, engagementsDir: tmp })
    try {
      const base = `http://127.0.0.1:${srv.port}`
      await rpc(base, srv.token, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
      const stamped = await rpc(base, srv.token, 'tools/call', { name: 'engagement_status', arguments: { id: 'eng-2026-10-28-spe5' } })
      const stampedResult = stamped['result'] as { structuredContent?: Record<string, unknown> }
      assert.deepEqual(stampedResult.structuredContent?.['speaker'], { name: 'OPERATOR', role: 'recon' })
      const plain = await rpc(base, srv.token, 'tools/call', { name: 'engagement_status', arguments: { id: 'eng-2026-10-28-spe6' } })
      const plainResult = plain['result'] as { structuredContent?: unknown }
      assert.equal('structuredContent' in plainResult, false)
    } finally {
      await srv.close()
    }
  })
})

describe('the MCP surface a chat host consumes', () => {
  it('lists the trio over /mcp and answers a status call', async () => {
    cannedState('eng-2026-10-28-eeee', 'complete', true)
    const srv = await startUiServer({ port: 0, engagementsDir: tmp })
    try {
      const base = `http://127.0.0.1:${srv.port}`
      await rpc(base, srv.token, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
      const list = await rpc(base, srv.token, 'tools/list')
      const tools = (list['result'] as { tools: Array<{ name: string }> }).tools.map(t => t.name)
      for (const name of ['engagement_launch', 'engagement_status', 'engagement_report']) {
        assert.ok(tools.includes(name), `${name} in tools/list`)
      }
      const call = await rpc(base, srv.token, 'tools/call', { name: 'engagement_status', arguments: { id: 'eng-2026-10-28-eeee' } })
      const result = call['result'] as { content: Array<{ text: string }>; isError?: boolean }
      assert.notEqual(result.isError, true)
      const body = JSON.parse(result.content[0]!.text) as Record<string, unknown>
      assert.equal(body['status'], 'complete')
      assert.equal(body['findings'], 2)
    } finally {
      await srv.close()
    }
  })
})

describe("desktop creation path — a chat launch on the operator's own machine", () => {
  it('authorizes into a guard that allows the attested bare hostname', async () => {
    // The exact chain eng-2026-11-02-353925bd took: engagement_launch
    // builds the body (scope defaults to the target's host — the bare
    // machine name), authorize attests from the record and stamps
    // verifiedScope, and the dispatch guard derives from that record.
    const built = buildLaunchBody({ target: 'Cho-zen1', objective: 'ADVERSARIAL PENTEST DEEPSCAN LOCAL HOST' })
    if ('error' in built) assert.fail(built.error)
    assert.deepEqual(built.body.scope, ['Cho-zen1'])
    assert.notEqual(built.body.operatorName, 'the desktop user')
    assert.ok((built.body.operatorName ?? '').trim().length > 0, 'no identity was recorded')

    const ctx = {
      domain: 'cho-zen1',
      hosts: ['cho-zen1'],
      input: {
        mode: 'red',
        objective: built.body.objective,
        operatorName: built.body.operatorName,
        roe: { scope: built.body.scope, outOfScope: [] as string[] },
      },
      config: { testMode: false, verifyViaService: false, mcpEndpoint: '', mcpToken: '', localSandbox: false },
      deps: {},
      events: {
        append: () => undefined,
        updateState: () => undefined,
      },
    } as unknown as Ctx

    const verdict = await authorizePhase(ctx)
    assert.equal(verdict.allowed, true)
    assert.deepEqual(ctx.verifiedScope, ['Cho-zen1'])

    const guard = scopeGuardFor(ctx)
    assert.equal(guard.checkHost('Cho-zen1').allowed, true, 'the attested host as the record names it')
    assert.equal(guard.checkHost('cho-zen1').allowed, true, 'the attested host as dispatch resolves it')
    assert.equal(guard.checkHost('other-host').allowed, false, 'nothing beyond the attested host opens up')
  })
})
