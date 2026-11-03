/**
 * Tool-output spill tests (Q-SPILL, spec poolpersist-spill §2.7).
 *
 * The integrity property under test: a tool result past the 4000-char
 * observation ceiling is NEVER silently destroyed — the full text lands
 * in the engagement's spill dir byte-identical (sha256 in the manifest),
 * the model sees head + pinned omission notice + tail, and read_spill
 * pages the whole thing back from inside a mechanical sandbox.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PREVIEW_HEAD_CHARS,
  PREVIEW_TAIL_CHARS,
  SPILL_THRESHOLD_CHARS,
  readSpill,
  spillNotice,
  spillToolResult,
} from '../src/tool-spill.js'
import { handleBookkeepingTools } from '../src/dispatch/bookkeeping.js'
import { agentLoop } from '../src/agents.js'
import { EventLog } from '../src/events.js'
import type { Ctx } from '../src/context.js'
import type { EngagementEvent } from '../src/types.js'
import type { VulnerabilityRegistry } from '../src/registry/store.js'
import type { ToolCallRequest } from '@secscan/redteam-llm-router'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function manifestLines(dir: string): Record<string, unknown>[] {
  const p = join(dir, 'spill', 'manifest.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as Record<string, unknown>)
}

describe('spillToolResult — threshold and preview (T-S2, T-S3)', () => {
  it('at exactly the threshold: verbatim, no file, no manifest', () => {
    const dir = tempDir('spill-t-')
    try {
      const text = 'a'.repeat(SPILL_THRESHOLD_CHARS)
      const out = spillToolResult({ dir, tool: 'http_probe', text })
      assert.equal(out.content, text)
      assert.equal(out.record, null)
      assert.equal(existsSync(join(dir, 'spill')), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('one char over: spills, content is head + pinned notice + tail within the old budget', () => {
    const dir = tempDir('spill-t-')
    try {
      const text = 'h'.repeat(PREVIEW_HEAD_CHARS) + 'm'.repeat(1000) + 't'.repeat(PREVIEW_TAIL_CHARS)
      assert.equal(text.length, 4200) // 2400 head + 1000 omitted + 800 tail
      const out = spillToolResult({ dir, tool: 'http_probe', text, attackId: 'T1190', target: 'shop.example.test' })
      assert.ok(out.record)
      assert.equal(out.record!.file, 'spill/0001-http_probe.txt')
      const expectedNotice = spillNotice(
        text.length - PREVIEW_HEAD_CHARS - PREVIEW_TAIL_CHARS,
        text.length,
        'http_probe',
        'spill/0001-http_probe.txt',
      )
      // The pinned notice template, verbatim shape:
      assert.equal(
        expectedNotice,
        '[spill: 1000 chars omitted — full 4200-char output of http_probe saved at spill/0001-http_probe.txt; call read_spill with path "spill/0001-http_probe.txt" and offsetChars to read it back]',
      )
      assert.equal(out.content, `${text.slice(0, PREVIEW_HEAD_CHARS)}\n${expectedNotice}\n${text.slice(-PREVIEW_TAIL_CHARS)}`)
      assert.ok(out.content.length <= SPILL_THRESHOLD_CHARS, 'spilled preview never costs more context than the old slice')
      // File holds the exact string.
      assert.equal(readFileSync(join(dir, 'spill', '0001-http_probe.txt'), 'utf8'), text)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('manifest fields are complete; chars and bytes are distinguished on multibyte input (T-S4)', () => {
    const dir = tempDir('spill-t-')
    try {
      const text = 'é'.repeat(4500) // 4500 chars, 9000 UTF-8 bytes
      const out = spillToolResult({ dir, tool: 'nuclei_exec', text, attackId: 'T1059', target: 'h.test' })
      assert.ok(out.record)
      const lines = manifestLines(dir)
      assert.equal(lines.length, 1)
      const m = lines[0]!
      assert.equal(m.tool, 'nuclei_exec')
      assert.equal(m.attackId, 'T1059')
      assert.equal(m.target, 'h.test')
      assert.equal(m.chars, 4500)
      assert.equal(m.bytes, 9000)
      assert.equal(m.headChars, PREVIEW_HEAD_CHARS)
      assert.equal(m.tailChars, PREVIEW_TAIL_CHARS)
      assert.equal(m.sha256, createHash('sha256').update(text, 'utf8').digest('hex'))
      assert.equal(m.file, out.record!.file)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sequence seeds from existing files — a resumed process never overwrites', () => {
    const dir = tempDir('spill-t-')
    try {
      mkdirSync(join(dir, 'spill'), { recursive: true })
      writeFileSync(join(dir, 'spill', '0003-http_probe.txt'), 'old')
      const out = spillToolResult({ dir, tool: 'http_probe', text: 'x'.repeat(5000) })
      assert.equal(out.record!.file, 'spill/0004-http_probe.txt')
      assert.equal(readFileSync(join(dir, 'spill', '0003-http_probe.txt'), 'utf8'), 'old')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('tool names are sanitized to one safe path segment', () => {
    const dir = tempDir('spill-t-')
    try {
      const out = spillToolResult({ dir, tool: '../evil tool/name', text: 'x'.repeat(5000) })
      assert.match(out.record!.file, /^spill\/\d{4}-[a-zA-Z0-9._-]+\.txt$/)
      assert.equal(out.record!.file.includes('..'), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('spillToolResult — failure and no-dir paths (T-S5, T-S7)', () => {
  it('unwritable spill location: falls back to the ceiling slice, flags the failure, references no file', () => {
    const dir = tempDir('spill-t-')
    try {
      const blocker = join(dir, 'blocker')
      writeFileSync(blocker, 'not a directory')
      const text = 'y'.repeat(6000)
      const out = spillToolResult({ dir: blocker, tool: 'http_probe', text })
      assert.equal(out.record, null)
      assert.ok(out.failed, 'failure class is reported for the audit event')
      assert.equal(out.content, text.slice(0, SPILL_THRESHOLD_CHARS))
      assert.equal(out.content.includes('spill/'), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("no engagement dir: today's slice behavior, no throw (partial test contexts)", () => {
    const text = 'z'.repeat(6000)
    const out = spillToolResult({ dir: undefined, tool: 'http_probe', text })
    assert.equal(out.content, text.slice(0, SPILL_THRESHOLD_CHARS))
    assert.equal(out.record, null)
    assert.equal(out.failed, undefined)
    const small = spillToolResult({ dir: undefined, tool: 'http_probe', text: 'short' })
    assert.equal(small.content, 'short')
  })
})

describe('readSpill — paging and sandbox (T-S6)', () => {
  function spilled(): { dir: string; text: string; rel: string } {
    const dir = tempDir('spill-t-')
    const text = '0123456789'.repeat(1000) // 10000 chars
    const out = spillToolResult({ dir, tool: 'ffuf_exec', text })
    return { dir, text, rel: out.record!.file }
  }

  it('pages reconstruct the full text exactly; trailers count down to end of spill', () => {
    const { dir, text, rel } = spilled()
    try {
      let rebuilt = ''
      let offset = 0
      for (let guard = 0; guard < 10; guard++) {
        const r = readSpill({ dir, path: rel, offsetChars: offset, maxChars: 4000 })
        assert.ok(r.ok)
        const lines = r.text.split('\n')
        const trailer = lines[lines.length - 1]!
        const window = lines.slice(0, -1).join('\n')
        rebuilt += window
        if (trailer.includes('end of spill')) break
        const m = /offsetChars (\d+)/.exec(trailer)
        assert.ok(m, `trailer names the next offset: ${trailer}`)
        offset = Number(m![1])
      }
      assert.equal(rebuilt, text)
      const first = readSpill({ dir, path: rel })
      assert.ok(first.ok)
      assert.match(first.text, /\[spill read: chars 0–4000 of 10000; 6000 remain — call again with offsetChars 4000\]$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maxChars is clamped to the 8000 hard max', () => {
    const { dir, rel } = spilled()
    try {
      const r = readSpill({ dir, path: rel, offsetChars: 0, maxChars: 99999 })
      assert.ok(r.ok)
      assert.match(r.text, /chars 0–8000 of 10000/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('offset beyond EOF returns the end-of-spill trailer and no content', () => {
    const { dir, rel } = spilled()
    try {
      const r = readSpill({ dir, path: rel, offsetChars: 99999 })
      assert.ok(r.ok)
      assert.equal(r.text, '[spill read: chars 10000–10000 of 10000; end of spill]')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses absolute paths, .. escapes, non-spill paths, and nested segments', () => {
    const { dir, rel } = spilled()
    try {
      const bad = [
        '/etc/passwd',
        'spill/../state.json',
        '../spill/0001-ffuf_exec.txt',
        'state.json',
        'spill/sub/0001-ffuf_exec.txt',
        'spill\\0001-ffuf_exec.txt',
        'spill/..',
        '',
      ]
      for (const p of bad) {
        const r = readSpill({ dir, path: p })
        assert.equal(r.ok, false, `refused: ${JSON.stringify(p)}`)
      }
      // A missing in-sandbox file is a plain error, not a refusal and not a throw.
      const missing = readSpill({ dir, path: 'spill/0999-nope.txt' })
      assert.equal(missing.ok, false)
      assert.match(missing.ok === false ? missing.error : '', /no such spill file/)
      // The real reference still works.
      assert.ok(readSpill({ dir, path: rel }).ok)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a symlink inside the spill dir that resolves outside it', (t) => {
    const { dir } = spilled()
    const outside = tempDir('spill-outside-')
    try {
      const secret = join(outside, 'secret.txt')
      writeFileSync(secret, 'outside-the-sandbox')
      try {
        symlinkSync(secret, join(dir, 'spill', '0009-evade.txt'))
      } catch (err) {
        // Windows refuses symlink creation without Developer Mode / SeCreateSymbolicLink,
        // so the escape cannot be constructed here. Skip rather than fail: the
        // guard itself is exercised on any platform that can build the fixture.
        if ((err as { code?: string }).code === 'EPERM') {
          t.skip('symlink creation requires a privilege this platform does not grant')
          return
        }
        throw err
      }
      const r = readSpill({ dir, path: 'spill/0009-evade.txt' })
      assert.equal(r.ok, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('read_spill handler (dispatch/bookkeeping)', () => {
  function fakeCtx(dir: string): Ctx {
    return { events: { dir }, registryHits: [] } as unknown as Ctx
  }
  const call = (args: Record<string, unknown>): ToolCallRequest =>
    ({ id: 'c1', name: 'read_spill', arguments: args }) as unknown as ToolCallRequest

  it('serves a spilled file and refuses traversal as plain results', async () => {
    const dir = tempDir('spill-t-')
    try {
      const text = 'q'.repeat(5000)
      const out = spillToolResult({ dir, tool: 'http_probe', text })
      const ok = await handleBookkeepingTools(fakeCtx(dir), 'recon', 'recon', call({ path: out.record!.file }), { path: out.record!.file })
      assert.ok(ok)
      assert.ok(ok!.result.startsWith('q'.repeat(4000)))
      assert.match(ok!.result, /\[spill read: chars 0–4000 of 5000; 1000 remain — call again with offsetChars 4000\]$/)
      const tail = await handleBookkeepingTools(
        fakeCtx(dir),
        'recon',
        'recon',
        call({ path: out.record!.file, offsetChars: 4000 }),
        { path: out.record!.file, offsetChars: 4000 },
      )
      assert.ok(tail)
      assert.match(tail!.result, /\[spill read: chars 4000–5000 of 5000; end of spill\]$/)
      const bad = await handleBookkeepingTools(fakeCtx(dir), 'recon', 'recon', call({ path: '../state.json' }), { path: '../state.json' })
      assert.ok(bad)
      assert.match(bad!.result, /refused/)
      const noPath = await handleBookkeepingTools(fakeCtx(dir), 'recon', 'recon', call({}), {})
      assert.ok(noPath)
      assert.match(noPath!.result, /path is required/)
      // Not a bookkeeping tool → null (other dispatchers own it).
      const other = await handleBookkeepingTools(fakeCtx(dir), 'recon', 'recon', { id: 'c2', name: 'http_probe', arguments: {} } as unknown as ToolCallRequest, {})
      assert.equal(other, null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Loop-level acceptance (T-S1): a >4000-char tool result driven through
// agentLoop must spill byte-identically and page back exactly.
// ---------------------------------------------------------------------------

type CompleteFn = (role: string, messages: unknown, opts: unknown) => Promise<unknown>

function seededRegistry(): VulnerabilityRegistry {
  const payload = `payload-${'x'.repeat(430)}${'é'.repeat(40)}`
  return {
    version: 1,
    confirmed: Array.from({ length: 10 }, (_, i) => ({
      kind: 'confirmed' as const,
      id: `vuln-${String(i + 1).padStart(4, '0')}`,
      date: `2026-10-${String(20 + i)}`,
      engagementId: 'eng-seed',
      target: { host: 'shop.example.test', stack: [], appType: 'unknown' },
      vulnClass: 'injection',
      technique: 'error-based',
      attackId: 'T1190',
      payloadPattern: payload,
      evidenceRef: 'steps.jsonl',
      severity: 'high' as const,
    })),
    killed: [],
  }
}

function loopCtx(dir: string, completeForRole: CompleteFn, registry: VulnerabilityRegistry): Ctx {
  return {
    actions: 0,
    consecutive5xx: 0,
    deniedStreak: 0,
    redirects: 0,
    startedAt: Date.now(),
    config: { maxActions: 1000, maxDurationMs: 60_000 },
    input: { roe: { blackoutWindows: [], scope: ['shop.example.test'] } },
    deps: { completeForRole },
    events: new EventLog(dir, 'eng-spill', { target: 'shop.example.test', mode: 'red', objective: 'test' }),
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
    safety: { killSwitchAborts: 0 },
    tier: { current: 0, chainSteps: new Map<string, number>() },
    hosts: ['shop.example.test'],
    domain: 'shop.example.test',
    plan: null,
    targetMap: [],
    liveFindings: [],
    killedLive: [],
    registry,
    registryHits: [],
    fingerprint: { stack: [], appType: 'unknown' },
    coverage: new Set(),
    targetCoverage: new Map(),
    itemLedger: new Map(),
    opsecCooldown: new Set<string>(),
  } as unknown as Ctx
}

const toolTurn = (name: string, args: Record<string, unknown> = {}) => ({
  text: '',
  toolCalls: [{ id: `c-${Math.random()}`, name, arguments: args }],
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
})
const idleTurn = { text: 'done', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }

describe('agentLoop spill seam (T-S1, T-S4)', () => {
  it('an over-threshold result spills byte-identically; the observation is head+notice+tail; read_spill reconstructs it', async () => {
    const dir = tempDir('spill-loop-')
    try {
      const registry = seededRegistry()
      // Ground truth: the exact handler result for this call, produced directly.
      const probeCtx = {
        events: { dir },
        registry,
        registryPath: undefined,
        registryHits: [],
        fingerprint: { stack: [], appType: 'unknown' },
      } as unknown as Ctx
      const direct = await handleBookkeepingTools(
        probeCtx,
        'recon',
        'recon',
        { id: 'probe', name: 'query_registry', arguments: { limit: 10 } } as unknown as ToolCallRequest,
        { limit: 10 },
      )
      assert.ok(direct)
      const full = direct!.result
      assert.ok(full.length > SPILL_THRESHOLD_CHARS, `fixture must exceed the ceiling (got ${full.length})`)

      const seenMessages: unknown[] = []
      const scripted: CompleteFn = async (_role, messages) => {
        seenMessages.push(messages)
        return seenMessages.length === 1 ? toolTurn('query_registry', { limit: 10 }) : idleTurn
      }
      const ctx = loopCtx(dir, scripted, registry)
      await agentLoop(ctx, 'recon', 'recon', 's', 'u', [], 10, {})

      // (a) exactly one spill file; (b) its bytes are the exact result string.
      const spillFiles = readdirSync(join(dir, 'spill')).filter(f => f.endsWith('.txt'))
      assert.equal(spillFiles.length, 1)
      const rel = `spill/${spillFiles[0]!}`
      assert.equal(readFileSync(join(dir, 'spill', spillFiles[0]!), 'utf8'), full)

      // (c) manifest sha256 matches the file; chars/bytes recorded (multibyte → bytes > chars).
      const m = manifestLines(dir)[0]!
      assert.equal(m.sha256, createHash('sha256').update(full, 'utf8').digest('hex'))
      assert.equal(m.chars, full.length)
      assert.equal(m.bytes, Buffer.byteLength(full, 'utf8'))
      assert.ok((m.bytes as number) > (m.chars as number), 'multibyte fixture: bytes exceed chars')
      assert.equal(m.tool, 'query_registry')

      // (d) the model-visible observation is head + notice + tail (+ digest).
      const turn2 = seenMessages[1] as Array<{ role: string; content: string }>
      const toolMsg = turn2.find(msg => msg.role === 'tool')
      assert.ok(toolMsg, 'second turn carries the tool observation')
      const notice = spillNotice(full.length - PREVIEW_HEAD_CHARS - PREVIEW_TAIL_CHARS, full.length, 'query_registry', rel)
      assert.ok(toolMsg!.content.startsWith(full.slice(0, PREVIEW_HEAD_CHARS)), 'observation opens with the head')
      assert.ok(toolMsg!.content.includes(notice), 'observation carries the pinned notice')
      assert.ok(toolMsg!.content.includes(full.slice(-PREVIEW_TAIL_CHARS)), 'observation carries the tail')

      // (e) audit event recorded (T-S4).
      const evs = readFileSync(join(dir, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as EngagementEvent)
      const spilled = evs.filter(e => e.action === 'tool_output_spilled')
      assert.equal(spilled.length, 1)
      assert.match(spilled[0]!.result, /query_registry: \d+ chars → spill\/\d{4}-query_registry\.txt \(sha256 [0-9a-f]{12}\)/)

      // (f) read_spill paging reconstructs the string exactly.
      let rebuilt = ''
      let offset = 0
      for (let guard = 0; guard < 6; guard++) {
        const r = readSpill({ dir, path: rel, offsetChars: offset, maxChars: 8000 })
        assert.ok(r.ok)
        if (r.text.startsWith('[spill read:')) break // empty final window
        const window = r.text.slice(0, r.text.lastIndexOf('\n[spill read:'))
        rebuilt += window
        offset += window.length
        if (r.text.includes('end of spill')) break
      }
      assert.equal(rebuilt, full)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an under-threshold result stays verbatim in the observation and creates no spill (T-S2 loop level)', async () => {
    const dir = tempDir('spill-loop-')
    try {
      const seenMessages: unknown[] = []
      const scripted: CompleteFn = async (_role, messages) => {
        seenMessages.push(messages)
        return seenMessages.length === 1
          ? toolTurn('update_target_map', { entries: [{ area: '/a', method: 'GET' }] })
          : idleTurn
      }
      const ctx = loopCtx(dir, scripted, seededRegistry())
      await agentLoop(ctx, 'recon', 'recon', 's', 'u', [], 10, {})
      assert.equal(existsSync(join(dir, 'spill')), false)
      const turn2 = seenMessages[1] as Array<{ role: string; content: string }>
      const toolMsg = turn2.find(msg => msg.role === 'tool')
      assert.ok(toolMsg)
      assert.equal(toolMsg!.content.includes('[spill:'), false)
      const evs = readFileSync(join(dir, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as EngagementEvent)
      assert.equal(evs.some(e => e.action === 'tool_output_spilled'), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
