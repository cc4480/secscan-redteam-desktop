/**
 * Runner tests — no network, no API keys. The LLM is not called in dry-run
 * mode and ownership verification uses the local in-app DNS-store/attestation
 * paths. Every fail-closed path must resolve to blocked/denied, never approval.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strFromU8, unzipSync } from 'fflate'
import {
  checkAuthorization,
  inBlackout,
  scopeHosts,
  techniqueAllowed,
  urlInScope } from '../src/gate.js'
import { readEvents, readState } from '../src/events.js'
import { validateProbeTarget, isPrivateOrLoopbackHost, WebProber } from '../src/prober.js'
import { resolveExcludedTechniques, defaultExcludedForMode, ALWAYS_EXCLUDED } from '../src/attack.js'
import { runEngagement, resolveConfig } from '../src/phases.js'
import type { ReportModel } from '../src/report/deliverables.js'
import type { EngagementInput } from '../src/types.js'

function input(mode: 'red' | 'black' = 'red'): EngagementInput {
  return {
    target: 'secscan.us',
    mode,
    objective: 'test objective',
    roe: { scope: ['secscan.us'] } }
}

function writeVerifiedStore(file: string, domains: string[]): void {
  const verified: Record<string, { token: string; verifiedAt: string; method: 'dns-txt' }> = {}
  for (const d of domains) {
    const key = d.trim().toLowerCase().replace(/\.$/, '')
    verified[key] = { token: 'secscan-verify-test', verifiedAt: '2026-01-01T00:00:00.000Z', method: 'dns-txt' }
  }
  writeFileSync(file, JSON.stringify({ version: 1, pending: {}, verified }, null, 2))
}

describe('checkAuthorization (both modes)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rt-auth-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  for (const mode of ['red', 'black'] as const) {
    it(`${mode}: blocked when the domain is not locally verified`, async () => {
      const storeFile = join(dir, `${mode}-empty.json`)
      writeVerifiedStore(storeFile, [])
      const v = await checkAuthorization('secscan.us', { storeFile })
      assert.equal(v.allowed, false)
      assert.match(v.reason ?? '', /not ownership-verified|local app store/i)
    })
    it(`${mode}: blocked when the local store is corrupt (fail closed)`, async () => {
      const storeFile = join(dir, `${mode}-corrupt.json`)
      writeFileSync(storeFile, '{not-json', 'utf8')
      const v = await checkAuthorization('secscan.us', { storeFile })
      assert.equal(v.allowed, false)
    })
    it(`${mode}: allowed when the domain is locally verified`, async () => {
      const storeFile = join(dir, `${mode}-ok.json`)
      writeVerifiedStore(storeFile, ['secscan.us'])
      const v = await checkAuthorization('secscan.us', { storeFile })
      assert.equal(v.allowed, true)
    })
  }
  it('rejects unparseable targets', async () => {
    const storeFile = join(dir, 'unparseable.json')
    writeVerifiedStore(storeFile, ['secscan.us'])
    const v = await checkAuthorization('not a url %%%', { storeFile })
    assert.equal(v.allowed, false)
  })
})

describe('scope enforcement', () => {
  it('normalizes scope entries to hostnames', () => {
    assert.deepEqual(scopeHosts({ scope: ['https://SecScan.US/path', 'www.example.com'] }), ['secscan.us', 'www.example.com'])
  })
  it('requires exact hostname match', () => {
    const hosts = ['secscan.us']
    assert.equal(urlInScope('https://secscan.us/scan', hosts), true)
    assert.equal(urlInScope('https://www.secscan.us/', hosts), false) // not exact
    assert.equal(urlInScope('https://evil.com/', hosts), false)
    assert.equal(urlInScope('not a url', hosts), false)
  })
})

describe('blackout windows', () => {
  // 2026-10-02T07:30:00Z == 02:30 America/Chicago (CDT, UTC-5)
  const d = (iso: string) => new Date(iso)
  it('detects inside/outside a window', () => {
    const w = [{ start: '02:00', end: '04:00', tz: 'America/Chicago' }]
    assert.ok(inBlackout(d('2026-10-02T07:30:00Z'), w))
    assert.equal(inBlackout(d('2026-10-02T09:30:00Z'), w), null)
  })
  it('handles windows crossing midnight', () => {
    const w = [{ start: '22:00', end: '02:00', tz: 'America/Chicago' }]
    assert.ok(inBlackout(d('2026-10-02T04:30:00Z'), w)) // 23:30 CDT
    assert.ok(inBlackout(d('2026-10-02T06:30:00Z'), w)) // 01:30 CDT
    assert.equal(inBlackout(d('2026-10-02T09:30:00Z'), w), null) // 04:30 CDT
  })
  it('ignores malformed windows instead of blocking on garbage', () => {
    assert.equal(inBlackout(d('2026-10-02T07:30:00Z'), [{ start: 'xx', end: 'yy' }]), null)
  })
  it('no windows → never in blackout', () => {
    assert.equal(inBlackout(new Date(), undefined), null)
  })
})

describe('technique exclusions', () => {
  it('T1499 is always excluded', () => {
    assert.ok(ALWAYS_EXCLUDED.includes('T1499'))
    assert.equal(techniqueAllowed('T1499', 'red', { scope: ['x'] }), false)
    assert.equal(techniqueAllowed('T1499', 'black', { scope: ['x'] }), false)
  })
  it('black mode excludes brute force by default; red does not', () => {
    assert.deepEqual(defaultExcludedForMode('black'), ['T1499', 'T1110'])
    assert.deepEqual(defaultExcludedForMode('red'), ['T1499'])
    assert.equal(techniqueAllowed('T1110', 'black', { scope: ['x'] }), false)
    assert.equal(techniqueAllowed('T1110', 'red', { scope: ['x'] }), true)
  })
  it('ROE exclusions are honored and normalized', () => {
    assert.deepEqual(resolveExcludedTechniques('red', ['t1190', 'T1190']), ['T1499', 'T1190'])
    assert.equal(techniqueAllowed('T1190', 'red', { scope: ['x'], excludedTechniques: ['T1190'] }), false)
  })
  it('unmapped actions are allowed (mapping is advisory)', () => {
    assert.equal(techniqueAllowed(undefined, 'black', { scope: ['x'] }), true)
  })
})

describe('prober guardrails', () => {
  const scope = ['secscan.us']
  it('allows in-scope http/https', () => {
    assert.deepEqual(validateProbeTarget('https://secscan.us/scan', scope), { ok: true })
  })
  it('rejects out-of-scope hosts', () => {
    const r = validateProbeTarget('https://evil.com/', scope)
    assert.equal(r.ok, false)
  })
  it('rejects private/loopback hosts', () => {
    for (const u of ['http://127.0.0.1/', 'http://10.0.0.5/x', 'http://192.168.1.1/', 'http://localhost:3000/']) {
      const r = validateProbeTarget(u, scope)
      assert.equal(r.ok, false, u)
    }
  })
  it('rejects non-http schemes', () => {
    assert.equal(validateProbeTarget('file:///etc/passwd', scope).ok, false)
    assert.equal(validateProbeTarget('gopher://secscan.us/', scope).ok, false)
  })
})

describe('local sandbox mode (explicit opt-in only)', () => {
  it('isPrivateOrLoopbackHost recognizes private ranges and loopback names', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '::1']) {
      assert.ok(isPrivateOrLoopbackHost(h), h)
    }
    for (const h of ['secscan.us', 'evil.com', '8.8.8.8']) {
      assert.ok(!isPrivateOrLoopbackHost(h), h)
    }
  })
  it('isPrivateOrLoopbackHost treats only the exact ::1 as IPv6 loopback', () => {
    assert.equal(isPrivateOrLoopbackHost('::1'), true)
    assert.equal(isPrivateOrLoopbackHost('[::1]'), true)
    assert.equal(isPrivateOrLoopbackHost('::1234'), false)
    assert.equal(isPrivateOrLoopbackHost('[::102:304]'), false)
  })
  it('without allowPrivateHosts, loopback is still rejected (default unchanged)', () => {
    const r = validateProbeTarget('http://localhost:3000/', ['localhost'])
    assert.equal(r.ok, false)
  })
  it('with allowPrivateHosts, an in-scope loopback host is allowed', () => {
    const r = validateProbeTarget('http://localhost:3000/', ['localhost'], { allowPrivateHosts: true })
    assert.deepEqual(r, { ok: true })
  })
  it('allowPrivateHosts never widens the scope check itself', () => {
    const r = validateProbeTarget('http://localhost:3000/', ['secscan.us'], { allowPrivateHosts: true })
    assert.equal(r.ok, false)
  })
  it('checkAuthorization: allowLocalSandbox bypasses local verification only for a private/loopback target', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-sandbox-'))
    try {
      const storeFile = join(dir, 'empty.json')
      writeVerifiedStore(storeFile, [])
      const localVerdict = await checkAuthorization('localhost', { storeFile, allowLocalSandbox: true })
      assert.equal(localVerdict.allowed, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('checkAuthorization: allowLocalSandbox has no effect on a real domain — local verification still gates it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-sandbox-'))
    try {
      const storeFile = join(dir, 'empty.json')
      writeVerifiedStore(storeFile, [])
      const verdict = await checkAuthorization('secscan.us', { storeFile, allowLocalSandbox: true })
      assert.equal(verdict.allowed, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('burst probe (resilience check, not a flood primitive)', () => {
  it('rejects non-GET/HEAD methods before any network call', async () => {
    const prober = new WebProber({ scopeHosts: ['secscan.us'] })
    await assert.rejects(() => prober.probeBurst({ method: 'POST', url: 'https://secscan.us/x' }), /GET\/HEAD/)
  })
  it('rejects out-of-scope targets before any network call', async () => {
    const prober = new WebProber({ scopeHosts: ['secscan.us'] })
    await assert.rejects(() => prober.probeBurst({ method: 'GET', url: 'https://evil.com/x' }), /refused/)
  })
  it('rejects loopback targets unless allowPrivateHosts is set (same invariant as probe())', async () => {
    const prober = new WebProber({ scopeHosts: ['localhost'] })
    await assert.rejects(() => prober.probeBurst({ method: 'GET', url: 'http://localhost:3000/x' }), /refused/)
  })
})

describe('runEngagement gating (dry-run agents, local verification)', () => {
  let dir: string
  let prevStoreEnv: string | undefined
  let storeFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rt-eng-'))
    prevStoreEnv = process.env['REDTEAM_VERIFIED_DOMAINS_FILE']
    storeFile = join(dir, 'verified-domains.json')
    writeVerifiedStore(storeFile, [])
    process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = storeFile
  })
  afterEach(() => {
    if (prevStoreEnv === undefined) delete process.env['REDTEAM_VERIFIED_DOMAINS_FILE']
    else process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = prevStoreEnv
    rmSync(dir, { recursive: true, force: true })
  })

  const baseOpts = () => ({
    deepseekApiKey: 'test',
    qwenApiKey: 'test',
    engagementsDir: dir,
    registryPath: join(dir, 'registry.json'),
    dryRunAgents: true,
    deps: {} })

  const withVerified = (domains: string[]) => writeVerifiedStore(storeFile, domains)

  for (const mode of ['red', 'black'] as const) {
    it(`${mode}: blocked end-to-end without verification, no tools touched`, async () => {
      withVerified([])
      const res = await runEngagement(input(mode), baseOpts())
      assert.equal(res.status, 'blocked')
      assert.match(res.blockedReason ?? '', /not ownership-verified/)
      const state = readState(join(dir, res.engagementId))
      assert.equal(state?.status, 'blocked')
      assert.equal(state?.verified, false)
    })
  }

  it('completes the loop on positive local verification and streams events', async () => {
    withVerified(['secscan.us'])
    const res = await runEngagement(input('red'), baseOpts())
    assert.equal(res.status, 'complete')
    assert.ok(res.reportPath && existsSync(res.reportPath))
    const engDir = join(dir, res.engagementId)
    assert.ok(existsSync(join(engDir, 'events.jsonl')))
    assert.ok(existsSync(join(engDir, 'engagement.md')))
    const state = readState(engDir)
    assert.equal(state?.status, 'complete')
    assert.equal(state?.verified, true)
    assert.ok(state?.verificationProof)
    const events = readEvents(engDir)
    assert.ok(events.length >= 5)
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i]!.seq > events[i - 1]!.seq)
    }
    const startIdx = events.findIndex(e => e.action === 'engagement_start')
    assert.ok(startIdx >= 0, 'engagement_start recorded')
    assert.ok(
      events.slice(0, startIdx).every(e => e.action === 'memory_store_initialized'),
      'only memory-store bootstrap precedes engagement_start',
    )
    assert.ok(events.some(e => e.action === 'authorization_basis'))
    assert.ok(events.some(e => e.phase === 'done'))
    const tail = readEvents(engDir, events[0]!.seq)
    assert.equal(tail.length, events.length - 1)
  })

  it('a dry-run completed close stamps artifactUnsigned dry-run in state, report.json and the package zip — exactly one stamp, no signoff (S6-H2b)', async () => {
    withVerified(['secscan.us'])
    const res = await runEngagement(input('red'), baseOpts())
    assert.equal(res.status, 'complete')
    assert.equal(res.deliverableFailed, undefined)
    const engDir = join(dir, res.engagementId)
    const state = readState(engDir)
    assert.equal(state?.status, 'complete')
    assert.equal(state?.artifactSignoff, null, 'a dry run carries no signoff in state')
    assert.equal(state?.artifactUnsigned?.reason, 'dry-run')
    assert.deepEqual(state?.artifactUnsigned?.defects, [])
    assert.equal(state?.artifactUnsigned?.cycles, 0)
    assert.ok(state?.artifactUnsigned?.at && !Number.isNaN(Date.parse(state.artifactUnsigned.at)), 'the stamp carries a timestamp')
    const model = JSON.parse(readFileSync(join(engDir, 'report.json'), 'utf8')) as ReportModel
    assert.equal(model.artifactSignoff, null)
    assert.deepEqual(model.artifactUnsigned, state?.artifactUnsigned, 'report.json carries the same dry-run stamp as state')
    const zip = unzipSync(readFileSync(join(engDir, 'report-package.zip')))
    const packagedEntry = zip['report.json']
    assert.ok(packagedEntry, 'the package zip carries report.json')
    const packaged = JSON.parse(strFromU8(packagedEntry)) as ReportModel
    assert.equal(packaged.artifactSignoff, null)
    assert.deepEqual(packaged.artifactUnsigned, state?.artifactUnsigned, "the zip's report.json carries the dry-run stamp")
    const events = readEvents(engDir)
    assert.equal(events.filter(e => e.action === 'artifact_unsigned').length, 1, 'exactly one unsigned stamp event')
    assert.ok(!events.some(e => e.action === 'artifact_signed'), 'no signature event on a dry run')
    const gateOutcome = events.find(e => e.action === 'scribe_gate_outcome')
    assert.ok(gateOutcome?.result.includes('shipped unsigned (dry-run) after 0'), 'the gate outcome event names the dry-run stamp')
  })

  it('a blocked dry-run close is never gated: no Scribe stamp in state or report.json (guard, passes on base)', async () => {
    withVerified([])
    const res = await runEngagement(input('red'), baseOpts())
    assert.equal(res.status, 'blocked')
    const engDir = join(dir, res.engagementId)
    const state = readState(engDir)
    assert.equal(state?.artifactSignoff ?? null, null)
    assert.equal(state?.artifactUnsigned ?? null, null)
    const model = JSON.parse(readFileSync(join(engDir, 'report.json'), 'utf8')) as ReportModel
    assert.equal('artifactSignoff' in model, false, 'a blocked close gains no signoff key')
    assert.equal('artifactUnsigned' in model, false, 'a blocked close gains no unsigned key')
    assert.ok(!readEvents(engDir).some(e => e.action === 'scribe_gate_outcome'), 'the gate never ran on a blocked close')
  })

  it('completes on an explicit operator attestation path when a verifier hook is injected', async () => {
    const inp = input('red')
    inp.operatorName = 'C. Operator'
    const res = await runEngagement(inp, {
      modelApiKey: 'test',
      engagementsDir: dir,
      registryPath: join(dir, 'registry.json'),
      dryRunAgents: true,
      deps: { verify: async () => true } })
    assert.equal(res.status, 'complete')
    const state = readState(join(dir, res.engagementId))
    assert.equal(state?.verified, true)
    assert.match(state?.verificationProof ?? '', /Operator-attested ownership/)
    assert.match(state?.verificationProof ?? '', /C\. Operator/)
  })

  it('blocks when an injected verifier does not verify the domain (fail closed)', async () => {
    const inp = input('red')
    inp.operatorName = 'C. Operator'
    const res = await runEngagement(inp, {
      modelApiKey: 'test',
      engagementsDir: dir,
      registryPath: join(dir, 'registry.json'),
      dryRunAgents: true,
      deps: { verify: async () => false } })
    assert.equal(res.status, 'blocked')
    const state = readState(join(dir, res.engagementId))
    assert.notEqual(state?.verified, true)
    assert.match(state?.blockedReason ?? '', /injected verifier did not verify/)
  })

  it('refuses to run outside the ROE test window', async () => {
    withVerified(['secscan.us'])
    const inp = input('red')
    inp.roe.testWindow = { start: '2020-01-01T00:00:00Z', end: '2020-01-02T00:00:00Z' }
    await assert.rejects(() => runEngagement(inp, baseOpts()), /test window/)
  })

  it('refuses empty/unparseable scope', async () => {
    withVerified(['secscan.us'])
    const inp = input('red')
    inp.roe.scope = ['%%%']
    await assert.rejects(() => runEngagement(inp, baseOpts()), /scope/)
  })

  it('starts with only the Meta key when REDTEAM_LLM_PROVIDER=meta selects the Meta seats', () => {
    const env = { MODEL_API_KEY: 'test', REDTEAM_LLM_PROVIDER: 'meta' } as NodeJS.ProcessEnv
    const cfg = resolveConfig(env, { engagementsDir: dir })
    assert.equal(cfg.modelApiKey, 'test')
  })

  it('a Meta key alone does not start a run: the fleet seats DeepSeek by default', () => {
    assert.throws(() => resolveConfig({ MODEL_API_KEY: 'test' } as NodeJS.ProcessEnv, { engagementsDir: dir }), /DEEPSEEK_API_KEY/)
  })

  it('fails fast with no model key at all, naming DEEPSEEK_API_KEY', () => {
    assert.throws(() => resolveConfig({} as NodeJS.ProcessEnv, { engagementsDir: dir }), /DEEPSEEK_API_KEY/)
    // An unrelated secret alone starts nothing: it is not a model key.
    const env = { SECSCAN_MCP_TOKEN: 'test' } as NodeJS.ProcessEnv
    assert.throws(() => resolveConfig(env, { engagementsDir: dir }), /DEEPSEEK_API_KEY/)
  })

  it('v0.6: does NOT require a Qwen key - no role currently routes to Qwen (see llm-router/src/policy.ts)', () => {
    const env = { DEEPSEEK_API_KEY: 'test' } as NodeJS.ProcessEnv
    const oldQwen = process.env['QWEN_API_KEY']
    const oldDash = process.env['DASHSCOPE_API_KEY']
    delete process.env['QWEN_API_KEY']
    delete process.env['DASHSCOPE_API_KEY']
    try {
      assert.doesNotThrow(() => resolveConfig(env, { engagementsDir: dir }))
    } finally {
      if (oldQwen !== undefined) process.env['QWEN_API_KEY'] = oldQwen
      if (oldDash !== undefined) process.env['DASHSCOPE_API_KEY'] = oldDash
    }
  })
})
