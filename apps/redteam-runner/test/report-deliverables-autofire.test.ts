/**
 * Q-DELIVERABLES-AUTOFIRE — the closing deliverable set fires from the
 * pipeline at every recorded engagement end, no exceptions:
 *
 *   (1) a completed engagement emits all seven artifacts, the result and
 *       the state record name every path, and an event attests the set;
 *   (2) a halted engagement emits the set with the halted grade
 *       convention (N/A) in HTML / JSON / TXT;
 *   (3) an authorization-blocked engagement (P3) emits the set with the
 *       block as the headline and grade N/A — a refused scan never
 *       vanishes silently;
 *   (4) a dry run emits the set, marked dry-run in the model documents;
 *   (5) sabotage — report.html's path blocked by a directory — records
 *       deliverable_failed on the completion record (typed state, not
 *       just an event) and never a clean engagement_complete;
 *   (6) reconciliation: the same findings and grade reconcile across
 *       HTML, JSON, TXT, MD, and CSV, and the package carries the twins.
 *
 * The run harness mirrors test/battery.test.ts (scripted per-role LLM,
 * fake prober — no network).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync } from 'fflate'
import type { AgentRole, ChatMessage, ChatResult, ToolCallRequest } from '@secscan/redteam-llm-router'
import { readEvents, readState, EventLog } from '../src/events.js'
import { runEngagement } from '../src/phases.js'
import type { EngagementInput } from '../src/types.js'
import { type Ctx } from '../src/context.js'
import {
  DELIVERABLE_FILES,
  deliverableToolFields,
  finalizeDeliverables,
  verifyDeliverables,
  type ReportModel,
} from '../src/report/deliverables.js'

const SEVEN = [...DELIVERABLE_FILES]

const FINDINGS_JSON = JSON.stringify({
  findings: [
    {
      id: 'F-1', severity: 'critical', title: 'Fixture critical flaw', attackIds: ['T1190'],
      evidence: 'fixture evidence one', fix: 'Apply the fixture patch.', retest: 'Re-probe the fixture.', status: 'confirmed',
    },
    {
      id: 'F-2', severity: 'low', title: 'Fixture low flaw', attackIds: ['T1190'],
      evidence: 'fixture evidence two', fix: 'Tighten the fixture header.', retest: 'Re-check the fixture header.', status: 'confirmed',
    },
  ],
})

/** The same two findings as a task's VERDICTS block — the path real
 * findings take into the live record (mergeVerdictBlock). Since the
 * H3 reconciliation, the signed record is built from the LIVE record
 * and the reporter's JSON (FINDINGS_JSON) contributes prose only, so
 * the fixture records its findings live, exactly as a task that
 * confirmed them would; reporter items with no live counterpart are
 * dropped by design and no longer reach the deliverables. */
const LIVE_VERDICTS = JSON.stringify({
  verdicts: [
    { kind: 'confirmed', severity: 'critical', title: 'Fixture critical flaw', attackId: 'T1190', evidence: 'fixture evidence one' },
    { kind: 'confirmed', severity: 'low', title: 'Fixture low flaw', attackId: 'T1190', evidence: 'fixture evidence two' },
  ],
})

/** The battery suite's scripted LLM, with a parameterized reporter and
 * an optional sign-off refusal (the deterministic halt trigger). */
function scriptedLlm(opts: { reporterFindings?: string; refuseSignOff?: boolean; liveFindings?: boolean } = {}) {
  const counts: Record<string, number> = {}
  const taskCalls: Record<string, number> = {}
  let replans = 0
  let verdictBlockSent = false
  const probe = (category: string, id: number): ToolCallRequest => ({
    id: `call-${id}`,
    name: 'http_probe',
    arguments: { method: 'GET', url: 'https://secscan.us/probe', category, attackId: 'T1190', hypothesis: `battery test ${category}` },
  })
  const textOnly = (text: string): ChatResult => ({ text, toolCalls: [], provider: 'fake', model: 'fake' })
  const taskJson = (tasks: object[], finish: boolean, note: string): ChatResult =>
    textOnly('```json ' + JSON.stringify({ tasks, finish, note }) + ' ```')
  return async (role: AgentRole, _messages: ChatMessage[], _opts: object): Promise<ChatResult> => {
    counts[role] = (counts[role] ?? 0) + 1
    const has = (s: string) => _messages.some(m => m.content.includes(s))
    if (role === 'coordinator') {
      if (has('Transition awaiting sign-off')) {
        return textOnly(opts.refuseSignOff ? 'WITHHELD: the brief is not sufficient.' : 'SIGN-OFF: test approval — brief is sufficient.')
      }
      if (has('DECOMPOSE')) {
        return taskJson([{ kind: 'probe', brief: 'test logic flaws', attackId: 'T1190', category: 'logic', maxTurns: 4 }], false, 'opening with logic')
      }
      if (has('RE-PLAN')) {
        replans++
        if (has('OVERRIDE')) {
          return taskJson(
            [
              { kind: 'probe', brief: 'test functionality abuse', attackId: 'T1190', category: 'functionality', maxTurns: 4 },
              { kind: 'probe', brief: 'test validation rigor', attackId: 'T1190', category: 'validation', maxTurns: 4 },
            ],
            false,
            'covering missing categories',
          )
        }
        if (replans === 1) return taskJson([], true, 'wrapping up early')
        if (_messages.some(m => m.content.includes('validation:MISSING'))) {
          return taskJson([{ kind: 'probe', brief: 'test validation rigor', attackId: 'T1190', category: 'validation', maxTurns: 4 }], false, 'retrying validation task dropped over cap')
        }
        return taskJson([], true, 'battery complete')
      }
      return textOnly('```json {"adversaryProfile":"test","steps":[]} ```')
    }
    if (role === 'recon') return textOnly('recon brief: surface mapped')
    if (role === 'reporter') return textOnly('# Report\n\n```json ' + (opts.reporterFindings ?? '{"findings":[]}') + ' ```')
    const n = counts[role]!
    const sys = _messages.find(m => m.role === 'system')?.content ?? ''
    const brief = sys.match(/- Task: ([^\n]+)/)?.[1] ?? `task-${n}`
    taskCalls[brief] = (taskCalls[brief] ?? 0) + 1
    if (taskCalls[brief] === 1) {
      const cat = sys.match(/Battery category: (\w+)/)?.[1] ?? 'logic'
      return { text: `${cat} hypothesis`, toolCalls: [probe(cat, n)], provider: 'fake', model: 'fake' }
    }
    if (opts.liveFindings && !verdictBlockSent) {
      verdictBlockSent = true
      return textOnly('TRIED: probe / OBSERVED: markers present / VERDICT: confirmed\n```json ' + LIVE_VERDICTS + ' ```')
    }
    return textOnly('TRIED: probe / OBSERVED: 200 ok / VERDICT: killed - no flaw')
  }
}

const fakeProber = { probe: async () => ({ status: 200, headers: {}, bodySnippet: 'ok', ms: 5 }) }

function assertFullSet(dir: string): void {
  for (const name of SEVEN) {
    assert.ok(existsSync(join(dir, name)), `${name} exists in the engagement directory`)
  }
}

describe('deliverable autofire (Q-DELIVERABLES-AUTOFIRE)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rt-deliv-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const runOpts = (llm: ReturnType<typeof scriptedLlm>, extra: Record<string, unknown> = {}) => ({
    mcpToken: 'test',
    deepseekApiKey: 'test',
    qwenApiKey: 'test',
    engagementsDir: dir,
    registryPath: join(dir, 'registry.json'),
    deps: { verify: async () => true, completeForRole: llm as never, prober: fakeProber },
    ...extra,
  })

  it('a completed engagement emits all seven artifacts and names them on the record', async () => {
    const input: EngagementInput = { target: 'secscan.us', mode: 'red', objective: 'deliverables test', roe: { scope: ['secscan.us'] } }
    const res = await runEngagement(input, runOpts(scriptedLlm({ reporterFindings: FINDINGS_JSON, liveFindings: true })))
    assert.equal(res.status, 'complete')
    assert.equal(res.deliverableFailed, undefined, 'no deliverable failure on a clean close')
    const engDir = join(dir, res.engagementId)
    assertFullSet(engDir)
    // The completion record names every deliverable path.
    assert.ok(res.deliverables, 'result carries the deliverable map')
    assert.deepEqual(Object.keys(res.deliverables).sort(), [...SEVEN].sort())
    for (const name of SEVEN) assert.equal(res.deliverables[name], join(engDir, name))
    // The state record carries the same inventory.
    const state = readState(engDir)
    assert.deepEqual(Object.keys(state?.deliverables ?? {}).sort(), [...SEVEN].sort())
    assert.notEqual(state?.deliverableFailed, true)
    // An event attests the set, and the clean completion event fired.
    const events = readEvents(engDir)
    assert.ok(events.some(e => e.action === 'deliverables_written'), 'deliverables_written event recorded')
    assert.ok(events.some(e => e.action === 'engagement_complete'), 'clean completion recorded')
    // Sizes are non-trivial.
    const html = readFileSync(join(engDir, 'report.html'), 'utf8')
    assert.ok(html.length > 5000, `report.html is substantive (${html.length} bytes)`)
    assert.ok(readFileSync(join(engDir, 'report.md'), 'utf8').length > 1000, 'report.md is substantive')
    assert.ok(readFileSync(join(engDir, 'report.txt'), 'utf8').length > 200, 'report.txt is substantive')
  })

  it('counts reconcile across HTML, JSON, TXT, MD, and CSV — and the package carries the twins', async () => {
    const input: EngagementInput = { target: 'secscan.us', mode: 'red', objective: 'reconciliation test', roe: { scope: ['secscan.us'] } }
    const res = await runEngagement(input, runOpts(scriptedLlm({ reporterFindings: FINDINGS_JSON, liveFindings: true })))
    assert.equal(res.status, 'complete')
    const engDir = join(dir, res.engagementId)
    const model = JSON.parse(readFileSync(join(engDir, 'report.json'), 'utf8')) as ReportModel
    assert.equal(model.findingCount, 2)
    assert.equal(model.findings.length, 2)
    assert.deepEqual(model.severityCounts, { critical: 1, high: 0, medium: 0, low: 1, info: 0 })
    assert.equal(model.status, 'complete')
    assert.ok(model.grade, 'a completed engagement carries a grade')
    const txt = readFileSync(join(engDir, 'report.txt'), 'utf8')
    assert.ok(txt.includes(`Grade: ${model.grade!.letter} (${model.grade!.score}/100`), 'TXT grade matches JSON grade')
    assert.ok(txt.includes('Findings: 2 — 1 critical'), 'TXT counts match JSON counts')
    for (const title of ['Fixture critical flaw', 'Fixture low flaw']) {
      assert.ok(txt.includes(title), `TXT carries ${title}`)
      const html = readFileSync(join(engDir, 'report.html'), 'utf8')
      assert.ok(html.includes(title), `HTML carries ${title}`)
      assert.ok(readFileSync(join(engDir, 'report.md'), 'utf8').includes(title), `MD carries ${title}`)
    }
    assert.ok(txt.includes('Apply the fixture patch.'), 'TXT carries the fix')
    const csv = readFileSync(join(engDir, 'findings.csv'), 'utf8').trim().split(/\r?\n/)
    assert.equal(csv.length - 1, 2, 'CSV carries one data row per finding')
    const zip = unzipSync(readFileSync(join(engDir, 'report-package.zip')))
    for (const name of ['report.html', 'report.md', 'report.json', 'report.txt', 'findings.csv', 'report.docx']) {
      assert.ok(zip[name], `package carries ${name}`)
    }
  })

  it('a refused sign-off ships the full set UNSIGNED instead of halting', async () => {
    const input: EngagementInput = { target: 'secscan.us', mode: 'red', objective: 'halt test', roe: { scope: ['secscan.us'] } }
    const res = await runEngagement(input, runOpts(scriptedLlm({ refuseSignOff: true })))
    // Q-NOHALT: the coordinator's refusal stops the signature, not the run.
    assert.equal(res.status, 'complete', 'a refused sign-off must not halt the engagement')
    assert.equal(res.deliverableFailed, undefined)
    const engDir = join(dir, res.engagementId)
    assertFullSet(engDir)
    assert.deepEqual(Object.keys(res.deliverables ?? {}).sort(), [...SEVEN].sort())
    assert.ok(readEvents(engDir).some(e => e.action === 'signoff_unsigned'), 'the unsigned transition is recorded')
    assert.ok(readEvents(engDir).some(e => e.action === 'deliverables_written'))
  })

  it('a blocked engagement emits the set with the block as headline and grade N/A', async () => {
    const input: EngagementInput = {
      target: 'example.com',
      mode: 'red',
      objective: 'blocked test',
      roe: { scope: ['example.com', '192.168.1.10'] },
    }
    const res = await runEngagement(input, runOpts(scriptedLlm(), { testMode: false, localSandbox: false }))
    assert.equal(res.status, 'blocked')
    assert.equal(res.deliverableFailed, undefined)
    const engDir = join(dir, res.engagementId)
    assertFullSet(engDir)
    assert.deepEqual(Object.keys(res.deliverables ?? {}).sort(), [...SEVEN].sort())
    const model = JSON.parse(readFileSync(join(engDir, 'report.json'), 'utf8')) as ReportModel
    assert.equal(model.status, 'blocked')
    assert.equal(model.grade, null)
    assert.match(model.reason ?? '', /private\/loopback/)
    const txt = readFileSync(join(engDir, 'report.txt'), 'utf8')
    assert.ok(txt.includes('BLOCKED'), 'TXT headlines the block')
    assert.ok(txt.includes('Grade: N/A'), 'TXT carries the N/A grade')
    const html = readFileSync(join(engDir, 'report.html'), 'utf8')
    assert.ok(html.includes('Engagement Blocked'), 'HTML carries the blocked banner')
    const md = readFileSync(join(engDir, 'report.md'), 'utf8')
    assert.ok(md.includes('BLOCKED'), 'MD headlines the block')
    assert.ok(!md.includes('**Grade A'), 'MD never prints a clean grade for a blocked scan')
  })

  it('a dry run emits the set, marked dry-run', async () => {
    const input: EngagementInput = { target: 'secscan.us', mode: 'red', objective: 'dry run test', roe: { scope: ['secscan.us'] } }
    const res = await runEngagement(input, {
      mcpToken: 'test',
      deepseekApiKey: 'test',
      qwenApiKey: 'test',
      engagementsDir: dir,
      registryPath: join(dir, 'registry.json'),
      dryRunAgents: true,
      deps: { verify: async () => true },
    })
    assert.equal(res.status, 'complete')
    const engDir = join(dir, res.engagementId)
    assertFullSet(engDir)
    const model = JSON.parse(readFileSync(join(engDir, 'report.json'), 'utf8')) as ReportModel
    assert.equal(model.status, 'dry-run')
    assert.equal(model.dryRun, true)
    const txt = readFileSync(join(engDir, 'report.txt'), 'utf8')
    assert.ok(txt.includes('DRY RUN'), 'TXT marks the dry run')
    assert.ok(readFileSync(join(engDir, 'report.md'), 'utf8').includes('dry-run'), 'MD marks the dry run')
  })

  it('sabotage: a blocked report.html path records deliverable_failed, never a clean completion', async () => {
    const engagementId = 'eng-deliverables-sabotage'
    const engDir = join(dir, engagementId)
    mkdirSync(engDir, { recursive: true })
    // A directory squatting on report.html's path: the HTML write fails
    // EISDIR inside its own failure domain, and the package then fails
    // on the missing deliverable.
    mkdirSync(join(engDir, 'report.html'))
    const input: EngagementInput = { target: 'secscan.us', mode: 'red', objective: 'sabotage test', roe: { scope: ['secscan.us'] } }
    const res = await runEngagement(input, runOpts(scriptedLlm({ reporterFindings: FINDINGS_JSON }), { engagementId }))
    assert.equal(res.status, 'complete', 'the run itself completed — the failure is the deliverable record')
    assert.equal(res.deliverableFailed, true, 'the completion record carries deliverableFailed')
    assert.ok(!(res.deliverables ?? {})['report.html'], 'report.html is absent from the delivered paths')
    assert.ok((res.deliverables ?? {})['report.json'], 'the remaining deliverables are still named')
    const state = readState(engDir)
    assert.equal(state?.deliverableFailed, true, 'the state record carries deliverableFailed')
    const events = readEvents(engDir)
    assert.ok(events.some(e => e.action === 'deliverable_failed'), 'deliverable_failed event recorded')
    assert.ok(!events.some(e => e.action === 'engagement_complete'), 'no clean completion event')
    // The surviving artifacts still landed.
    for (const name of ['report.md', 'report.json', 'report.txt', 'findings.csv', 'report.docx']) {
      assert.ok(existsSync(join(engDir, name)), `${name} still emitted`)
    }
  })

  it('the chat surface names the set — and surfaces a missing HTML as a gap (probe 7)', () => {
    const engDir = join(dir, 'eng-tool-fields')
    mkdirSync(engDir, { recursive: true })
    for (const name of SEVEN) writeFileSync(join(engDir, name), 'x')
    const full = deliverableToolFields(engDir)
    assert.equal(full['reportHtmlPath'], join(engDir, 'report.html'))
    assert.equal(full['reportJsonPath'], join(engDir, 'report.json'))
    assert.equal(full['reportTxtPath'], join(engDir, 'report.txt'))
    assert.equal(full['reportPackagePath'], join(engDir, 'report-package.zip'))
    assert.equal(full['deliverableGap'], undefined)
    rmSync(join(engDir, 'report.html'))
    const gapped = deliverableToolFields(engDir)
    assert.equal(gapped['reportHtmlPath'], undefined, 'no silent path for a missing HTML')
    assert.match(gapped['deliverableGap'] ?? '', /report\.html is missing/)
  })

  it('finalizeDeliverables names a single missing file and stamps the record', () => {
    const engDir = join(dir, 'eng-finalize-unit')
    mkdirSync(engDir, { recursive: true })
    const log = new EventLog(engDir, 'eng-finalize-unit', {
      target: 'secscan.us', mode: 'red', objective: 'unit',
    })
    for (const name of SEVEN.filter(n => n !== 'report.txt')) {
      // Files only — finalize verifies presence, not content.
      writeFileSync(join(engDir, name), 'x')
    }
    const outcome = finalizeDeliverables({ events: log } as unknown as Ctx)
    assert.equal(outcome.ok, false)
    assert.deepEqual(outcome.missing, ['report.txt'])
    assert.equal(log.snapshot.deliverableFailed, true)
    assert.equal(log.snapshot.deliverables?.['report.txt'], undefined)
    assert.ok(readEvents(engDir).some(e => e.action === 'deliverable_failed'))
    const check = verifyDeliverables(engDir)
    assert.deepEqual(check.missing, ['report.txt'])
  })
})
