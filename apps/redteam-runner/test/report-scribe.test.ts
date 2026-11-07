/**
 * SCRIBE GATE — the publisher seat (Carlos's order, 2026-11-01): the
 * dedicated report-writing seat authors the report, authors the HTML,
 * reviews its own finished set, and signs it — or ships it UNSIGNED.
 *
 *   (1) sign path: stamp lands in state + report.json, no regeneration;
 *   (2) reject → regenerate → rewrite → sign: the defect list rides the
 *       artifact_rejected event, the gate spends exactly one repair;
 *   (3) reject-exhausted: UNSIGNED with defects, never a signature;
 *   (4) halted engagements: no Scribe call at all (mechanical close);
 *   (5) the seat throws / answers unparseably: UNSIGNED
 *       scribe_unavailable, the close never blocked;
 *   (6) fleet assembly: the publisher pack carries the scribe soul and
 *       both report skills in full; the other seats are unchanged.
 *
 * The gate unit tests drive report/scribe.ts over a fixture engagement
 * directory with a scripted completion seam; the end-to-end tests run
 * the autofire harness shape (scripted per-role LLM, fake prober).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strFromU8, unzipSync } from 'fflate'
import type { AgentRole, ChatMessage, ChatResult, ToolCallRequest } from '@secscan/redteam-llm-router'
import type { VerifiedEngagementRecord } from '@secscan/redteam-fleet-skills'
import { EventLog, readEvents, readState } from '../src/events.js'
import { type Ctx } from '../src/context.js'
import { runEngagement } from '../src/phases.js'
import type { EngagementInput } from '../src/types.js'
import {
  parseScribeVerdict,
  scribeGate,
  scribeMaxCycles,
  type ScribeDefect,
} from '../src/report/scribe.js'
import { extractAuthoredHtml, gateAuthoredHtml } from '../src/report/scribe-html.js'
import { type ReportModel } from '../src/report/deliverables.js'
import { publisherPrompt, reporterPrompt } from '../src/prompts.js'
import type { PromptContext } from '../src/prompts/shared.js'

const TITLES = ['Fixture critical flaw', 'Fixture low flaw']

const textOnly = (text: string): ChatResult => ({ text, toolCalls: [], provider: 'fake', model: 'fake' })

/** A complete, self-contained, gate-passing page in the Scribe's hand. */
function scribeHtml(titles: readonly string[], marker = 'SCRIBE-AUTHORED'): string {
  const pad = 'glass on zinc; spacing rhythm 4/8/12/16/24/32; gauge sweep 900ms ease-out; count-up in step; staggered reveal; reduced motion static; print final states. '.repeat(8)
  const cards = titles.map(t =>
    `<section class="finding"><h3>${t}</h3>` +
    '<p>Evidence of record: the probe response and the audit-log excerpt that prove this finding, quoted in full.</p>' +
    '<p>Fix of record: the concrete remediation the client applies, with the retest that proves it held.</p></section>',
  ).join('\n')
  return (
    '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Penetration Test Report — secscan.us</title>' +
    `<style>:root{color-scheme:dark}body{background:#09090b;color:#fafafa;font-family:system-ui}/* ${pad} */</style></head>` +
    `<body><!-- ${marker} --><header><h1>secscan.us — Penetration Test Report</h1>` +
    '<p>Anchored grade F (12/100). Two findings of record: one critical, one low. Battery totals: three items — two confirmed, one executed-clean.</p></header>' +
    `${cards}<footer>Report written and signed by the Scribe from the engagement's proven record.</footer></body></html>`
  )
}

const FIXTURE_MODEL: ReportModel = {
  kind: 'secscan-redteam-report',
  version: 1,
  engagementId: 'eng-scribe-fixture',
  target: 'secscan.us',
  mode: 'red',
  objective: 'scribe fixture',
  status: 'complete',
  dryRun: false,
  generatedAt: '2026-11-01T00:00:00.000Z',
  grade: { letter: 'F', score: 12, rating: 'Critical risk' },
  severityCounts: { critical: 1, high: 0, medium: 0, low: 1, info: 0 },
  findingCount: 2,
  batteryTotals: { total: 3, confirmed: 2, executedClean: 1, killed: 0, blocked: 0, na: 0, pending: 0 },
  coverageCells: [],
  findings: TITLES.map((title, i) => ({
    id: `F-${i + 1}`,
    severity: i === 0 ? 'critical' : 'low',
    title,
    attackIds: ['T1190'],
    evidence: `fixture evidence ${i + 1}`,
    fix: `fixture fix ${i + 1}`,
    retest: 're-probe the fixture',
    status: 'confirmed',
  })) as ReportModel['findings'],
}

/** Write the fixture closing set: the model + the four readable
 * artifacts + the two binary deliverables (bytes only — emitReportPackage
 * reads them back verbatim). report.md optionally carries the seeded
 * wrong count for the reject path. */
function writeFixtureSet(dir: string, opts: { wrongCount?: boolean } = {}): void {
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(FIXTURE_MODEL, null, 2)}\n`)
  writeFileSync(join(dir, 'report.md'), `# Report\n\nFindings: ${opts.wrongCount ? 99 : 2} — 1 critical, 1 low.\n\n${TITLES.join('\n')}\n`)
  writeFileSync(join(dir, 'report.txt'), `Grade: F (12/100)\nFindings: 2 — 1 critical\n${TITLES.join('\n')}\n`)
  writeFileSync(join(dir, 'findings.csv'), `id,severity,title\nF-1,critical,${TITLES[0]}\nF-2,low,${TITLES[1]}\n`)
  writeFileSync(join(dir, 'report.html'), scribeHtml(TITLES))
  writeFileSync(join(dir, 'report.docx'), 'fixture docx bytes')
  writeFileSync(join(dir, 'report-package.zip'), 'fixture zip bytes')
}

type CompleteFn = (role: AgentRole, messages: ChatMessage[], opts: object) => Promise<ChatResult>

/** A hand-built context over a real EventLog — the slices the gate and
 * the publisher prompt read (deps seam, events, input, hosts, config). */
function fixtureCtx(dir: string, completeForRole: CompleteFn): Ctx {
  const events = new EventLog(dir, 'eng-scribe-fixture', { target: 'secscan.us', mode: 'red', objective: 'scribe fixture' })
  return {
    events,
    input: { target: 'secscan.us', mode: 'red', objective: 'scribe fixture', roe: { scope: ['secscan.us'] }, client: 'Fixture Owner LLC', operatorName: 'Fixture Operator' },
    config: { dryRunAgents: false, localSandbox: false, testMode: true },
    deps: { completeForRole },
    hosts: ['secscan.us'],
    domain: 'secscan.us',
  } as unknown as Ctx
}

const REJECT_DEFECT: ScribeDefect = {
  file: 'report.md',
  class: 'accuracy',
  detail: 'report.md states 99 findings; the model carries 2',
  fix: 'Re-render the counts from the model',
}

describe('scribe gate — parsing and knobs', () => {
  it('parses sign and reject verdicts; off-shape answers are null', () => {
    assert.deepEqual(parseScribeVerdict('```json {"verdict":"sign","defects":[]} ```'), { verdict: 'sign', defects: [] })
    const rejected = parseScribeVerdict(JSON.stringify({ verdict: 'reject', defects: [REJECT_DEFECT] }))
    assert.equal(rejected?.verdict, 'reject')
    assert.equal(rejected?.defects.length, 1)
    assert.equal(rejected?.defects[0]?.detail, REJECT_DEFECT.detail)
    assert.equal(parseScribeVerdict('{"verdict":"reject","defects":[]}'), null, 'a reject naming nothing is not a verdict')
    assert.equal(parseScribeVerdict('the set looks fine to me'), null)
    assert.equal(parseScribeVerdict('{"verdict":"maybe"}'), null)
  })

  it('extracts and gates authored HTML', () => {
    const good = scribeHtml(TITLES)
    assert.equal(extractAuthoredHtml('```html\n' + good + '\n```'), good)
    assert.equal(extractAuthoredHtml('Here is your report, hope you like it'), null)
    assert.equal(extractAuthoredHtml('<!DOCTYPE html><html><body>truncated'), null)
    assert.deepEqual(gateAuthoredHtml(good, { target: 'secscan.us', findings: TITLES.map(title => ({ title })) }), [])
    const external = good.replace('</head>', '<link rel="stylesheet" href="https://cdn.example.com/x.css"></head>')
    assert.ok(gateAuthoredHtml(external, { target: 'secscan.us', findings: [] }).some(d => d.includes('external')))
    const missing = gateAuthoredHtml(good, { target: 'secscan.us', findings: [{ title: 'A finding that is not on the page' }] })
    assert.ok(missing.some(d => d.includes('missing from the page')))
  })

  it('resolves the cycle budget from the fleet knob default (2)', () => {
    assert.equal(scribeMaxCycles(), 2)
  })
})

describe('scribe gate — the close-out loop', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rt-scribe-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('(1) sign: the stamp lands in state + report.json, no regeneration spent', async () => {
    writeFixtureSet(dir)
    let regenerations = 0
    const complete: CompleteFn = async (_role, messages) => {
      assert.ok(messages.some(m => m.content.includes('Review the finished deliverable set')), 'the seat is asked to review')
      return textOnly('{"verdict":"sign","defects":[]}')
    }
    const outcome = await scribeGate(fixtureCtx(dir, complete), { regenerate: () => { regenerations++ } })
    assert.equal(outcome.signed, true)
    assert.equal(outcome.cycles, 1)
    assert.equal(regenerations, 0, 'a signed set is never regenerated')
    const state = readState(dir)
    assert.equal(state?.artifactSignoff?.by, 'scribe')
    assert.equal(state?.artifactSignoff?.cycles, 1)
    assert.equal(state?.artifactUnsigned, null)
    const model = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as ReportModel
    assert.equal(model.artifactSignoff?.by, 'scribe')
    assert.equal(model.artifactUnsigned, null)
    assert.ok(readEvents(dir).some(e => e.action === 'artifact_signed'), 'artifact_signed event recorded')
  })

  it("(1b) the review brief carries each finding's evidence and its decisive PoC events", async () => {
    writeFixtureSet(dir)
    // F-1's PoC bundle on disk, as the report phase leaves it: one
    // validating (decisive) step and one step with no validation signal.
    mkdirSync(join(dir, 'poc'))
    writeFileSync(join(dir, 'poc', 'F-1.json'), JSON.stringify({
      version: 1,
      bundleId: 'POC-eng-scribe-fixture-F-1',
      engagementId: 'eng-scribe-fixture',
      findingId: 'F-1',
      attackIds: ['T1190'],
      severity: 'critical',
      title: TITLES[0],
      target: 'secscan.us',
      operator: 'Fixture Operator',
      generatedAt: '2026-11-01T00:00:00.000Z',
      steps: [
        { seq: 7, ts: '2026-11-01T00:00:07.000Z', tool: 'http_probe', command: 'GET https://secscan.us/probe', result: 'marker REDTEAM-MARKER-FIXTURE echoed back in the response body', validation: 'marker-echo', marker: 'FIXTURE', replay: null },
        { seq: 8, ts: '2026-11-01T00:00:08.000Z', tool: 'http_probe', command: 'GET https://secscan.us/other', result: 'unvalidated noise step result', validation: 'none', replay: null },
      ],
      validationTier: 'execution',
      proves: 'http_probe executed the runner-built canary on secscan.us (T1190); marker REDTEAM-MARKER-FIXTURE echoed back.',
      doesNotProve: 'Full impact beyond the executed action.',
      reverifyCommand: 'redteam-runner reverify --bundle poc/F-1.json --scope secscan.us --execute',
    }))
    let brief = ''
    const complete: CompleteFn = async (_role, messages) => {
      brief = messages.map(m => m.content).join('\n')
      return textOnly('{"verdict":"sign","defects":[]}')
    }
    const outcome = await scribeGate(fixtureCtx(dir, complete), { regenerate: () => {} })
    assert.equal(outcome.signed, true)
    assert.ok(brief.includes('fixture evidence 1'), "the brief carries F-1's evidence text")
    assert.ok(brief.includes('fixture evidence 2'), "the brief carries F-2's evidence text")
    assert.ok(brief.includes('PoC (execution tier, poc/F-1.json)'), "the brief names F-1's PoC bundle and tier")
    assert.ok(brief.includes('marker REDTEAM-MARKER-FIXTURE echoed back'), "the brief carries the bundle's proves line")
    assert.ok(brief.includes('Decisive PoC events: seq 7 http_probe: marker REDTEAM-MARKER-FIXTURE echoed back in the response body'), 'the brief carries the decisive PoC event')
    assert.ok(!brief.includes('unvalidated noise step result'), 'steps without a validation signal are not decisive and stay out')
    assert.equal(brief.split('Decisive PoC events').length - 1, 1, 'only F-1 has a bundle — F-2 gets no PoC claim')
  })

  it('(2) reject → regenerate → rewrite → sign, the defect riding the event', async () => {
    writeFixtureSet(dir, { wrongCount: true })
    let reviews = 0
    let regenerations = 0
    const complete: CompleteFn = async (_role, messages) => {
      const joined = messages.map(m => m.content).join('\n')
      if (joined.includes('Rewrite the report HTML')) return textOnly('```html\n' + scribeHtml(TITLES, 'SCRIBE-REWRITTEN') + '\n```')
      reviews++
      return textOnly(JSON.stringify(reviews === 1 ? { verdict: 'reject', defects: [REJECT_DEFECT] } : { verdict: 'sign', defects: [] }))
    }
    const outcome = await scribeGate(fixtureCtx(dir, complete), {
      regenerate: (d) => {
        regenerations++
        writeFileSync(join(d, 'report.md'), readFileSync(join(d, 'report.md'), 'utf8').replace('Findings: 99', 'Findings: 2'))
      },
    })
    assert.equal(outcome.signed, true)
    assert.equal(outcome.cycles, 2)
    assert.equal(regenerations, 1, 'exactly one regeneration between the two reviews')
    const events = readEvents(dir)
    const rejected = events.find(e => e.action === 'artifact_rejected')
    assert.ok(rejected, 'artifact_rejected event recorded')
    assert.ok(rejected.result.includes(REJECT_DEFECT.detail), 'the event carries the itemized defect')
    assert.ok(events.some(e => e.action === 'scribe_html_rewritten'), 'the HTML rewrite is recorded')
    assert.ok(readFileSync(join(dir, 'report.html'), 'utf8').includes('SCRIBE-REWRITTEN'), 'the rewritten page is on disk')
    const state = readState(dir)
    assert.equal(state?.artifactSignoff?.cycles, 2, 'the stamp records the cycles spent')
  })

  it('(3) reject-exhausted: UNSIGNED with the defects, never a signature', async () => {
    writeFixtureSet(dir, { wrongCount: true })
    let regenerations = 0
    const complete: CompleteFn = async (_role, messages) => {
      const joined = messages.map(m => m.content).join('\n')
      if (joined.includes('Rewrite the report HTML')) return textOnly('```html\n' + scribeHtml(TITLES) + '\n```')
      return textOnly(JSON.stringify({ verdict: 'reject', defects: [REJECT_DEFECT] }))
    }
    const outcome = await scribeGate(fixtureCtx(dir, complete), { regenerate: () => { regenerations++ } })
    assert.equal(outcome.signed, false)
    assert.equal(outcome.reason, 'defects')
    assert.equal(outcome.cycles, 2)
    assert.equal(regenerations, 1, 'regeneration happens between cycles, not after the last')
    const state = readState(dir)
    assert.equal(state?.artifactSignoff, null)
    assert.equal(state?.artifactUnsigned?.reason, 'defects')
    assert.equal(state?.artifactUnsigned?.defects[0]?.detail, REJECT_DEFECT.detail)
    const model = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as ReportModel
    assert.equal(model.artifactUnsigned?.reason, 'defects')
    const events = readEvents(dir)
    assert.ok(!events.some(e => e.action === 'artifact_signed'), 'no signature event on an unsigned set')
    assert.equal(events.filter(e => e.action === 'artifact_rejected').length, 2, 'both rejections are on the record')
    assert.ok(events.some(e => e.action === 'artifact_unsigned'), 'the unsigned ship is on the record')
  })

  it('(5) a throwing seat: UNSIGNED scribe_unavailable, the gate returns', async () => {
    writeFixtureSet(dir)
    const complete: CompleteFn = async () => { throw new Error('provider 503: model unavailable') }
    const outcome = await scribeGate(fixtureCtx(dir, complete))
    assert.equal(outcome.signed, false)
    assert.equal(outcome.reason, 'scribe_unavailable')
    const state = readState(dir)
    assert.equal(state?.artifactUnsigned?.reason, 'scribe_unavailable')
    assert.equal(state?.artifactSignoff, null)
  })

  it('(7) dry-run: the gate stamps UNSIGNED dry-run in state + report.json + the package zip, and never calls the seat', async () => {
    writeFixtureSet(dir)
    let reviews = 0
    const complete: CompleteFn = async () => { reviews++; return textOnly('{"verdict":"sign","defects":[]}') }
    const ctx = fixtureCtx(dir, complete)
    ctx.config.dryRunAgents = true
    const outcome = await scribeGate(ctx)
    assert.equal(outcome.signed, false)
    assert.equal(outcome.cycles, 0)
    assert.equal(outcome.reason, 'dry-run')
    assert.equal(reviews, 0, 'a dry run never calls the review seat')
    const state = readState(dir)
    assert.equal(state?.artifactSignoff, null, 'a dry run carries no signoff')
    assert.equal(state?.artifactUnsigned?.reason, 'dry-run')
    assert.deepEqual(state?.artifactUnsigned?.defects, [])
    assert.equal(state?.artifactUnsigned?.cycles, 0)
    assert.ok(state?.artifactUnsigned?.at && !Number.isNaN(Date.parse(state.artifactUnsigned.at)), 'the stamp carries a timestamp')
    const model = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as ReportModel
    assert.equal(model.artifactSignoff, null)
    assert.deepEqual(model.artifactUnsigned, state?.artifactUnsigned, 'report.json carries the same dry-run stamp as state')
    const zip = unzipSync(readFileSync(join(dir, 'report-package.zip')))
    const packagedEntry = zip['report.json']
    assert.ok(packagedEntry, 'the package zip carries report.json')
    const packaged = JSON.parse(strFromU8(packagedEntry)) as ReportModel
    assert.equal(packaged.artifactSignoff, null)
    assert.deepEqual(packaged.artifactUnsigned, state?.artifactUnsigned, "the zip's report.json carries the dry-run stamp")
    const events = readEvents(dir)
    assert.equal(events.filter(e => e.action === 'artifact_unsigned').length, 1, 'exactly one unsigned stamp event')
    assert.ok(!events.some(e => e.action === 'artifact_signed'), 'no signature event on a dry run')
  })

  it('(5b) an unparseable answer: UNSIGNED scribe_unavailable, no fabricated verdict', async () => {
    writeFixtureSet(dir)
    const complete: CompleteFn = async () => textOnly('I reviewed everything and it all looks great, trust me.')
    const outcome = await scribeGate(fixtureCtx(dir, complete))
    assert.equal(outcome.signed, false)
    assert.equal(outcome.reason, 'scribe_unavailable')
    assert.ok(readEvents(dir).some(e => e.action === 'artifact_unsigned'))
  })
})

/** The autofire harness's scripted LLM, extended for the Scribe's three
 * report-role calls: authorship, HTML authoring, and the gate review. */
function e2eLlm(opts: { refuseSignOff?: boolean; reviewThrows?: boolean; track?: { reviews: number; htmlAuthors: number } } = {}) {
  const counts: Record<string, number> = {}
  const taskCalls: Record<string, number> = {}
  let replans = 0
  const probe = (category: string, id: number): ToolCallRequest => ({
    id: `call-${id}`,
    name: 'http_probe',
    arguments: { method: 'GET', url: 'https://secscan.us/probe', category, attackId: 'T1190', hypothesis: `battery test ${category}` },
  })
  const taskJson = (tasks: object[], finish: boolean, note: string): ChatResult =>
    textOnly('```json ' + JSON.stringify({ tasks, finish, note }) + ' ```')
  const FINDINGS_JSON = JSON.stringify({
    findings: TITLES.map((title, i) => ({
      id: `F-${i + 1}`, severity: i === 0 ? 'critical' : 'low', title, attackIds: ['T1190'],
      evidence: `fixture evidence ${i + 1}`, fix: `fixture fix ${i + 1}`, retest: 're-probe the fixture', status: 'confirmed',
    })),
  })
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
    if (role === 'reporter') {
      if (has('Review the finished deliverable set')) {
        if (opts.track) opts.track.reviews++
        if (opts.reviewThrows) throw new Error('provider 503: review seat unavailable')
        return textOnly('{"verdict":"sign","defects":[]}')
      }
      if (has('Author the report HTML now')) {
        if (opts.track) opts.track.htmlAuthors++
        return textOnly('```html\n' + scribeHtml(TITLES) + '\n```')
      }
      return textOnly('# Report\n\n```json ' + FINDINGS_JSON + ' ```')
    }
    const n = counts[role]!
    const sys = _messages.find(m => m.role === 'system')?.content ?? ''
    const brief = sys.match(/- Task: ([^\n]+)/)?.[1] ?? `task-${n}`
    taskCalls[brief] = (taskCalls[brief] ?? 0) + 1
    if (taskCalls[brief] === 1) {
      const cat = sys.match(/Battery category: (\w+)/)?.[1] ?? 'logic'
      return { text: `${cat} hypothesis`, toolCalls: [probe(cat, n)], provider: 'fake', model: 'fake' }
    }
    return textOnly('TRIED: probe / OBSERVED: 200 ok / VERDICT: killed - no flaw')
  }
}

const fakeProber = { probe: async () => ({ status: 200, headers: {}, bodySnippet: 'ok', ms: 5 }) }

describe('scribe gate — end to end', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rt-scribe-e2e-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const runOpts = (llm: ReturnType<typeof e2eLlm>) => ({
    mcpToken: 'test',
    deepseekApiKey: 'test',
    qwenApiKey: 'test',
    engagementsDir: dir,
    registryPath: join(dir, 'registry.json'),
    deps: { verify: async () => true, completeForRole: llm as never, prober: fakeProber },
  })
  const input: EngagementInput = { target: 'secscan.us', mode: 'red', objective: 'scribe e2e', roe: { scope: ['secscan.us'] } }

  it("(1e) a completed engagement ships the Scribe's HTML, signed", async () => {
    const track = { reviews: 0, htmlAuthors: 0 }
    const res = await runEngagement(input, runOpts(e2eLlm({ track })))
    assert.equal(res.status, 'complete')
    assert.equal(res.deliverableFailed, undefined)
    const engDir = join(dir, res.engagementId)
    assert.equal(track.htmlAuthors, 1, 'the Scribe authored the HTML once')
    assert.equal(track.reviews, 1, 'the Scribe reviewed the set once')
    const html = readFileSync(join(engDir, 'report.html'), 'utf8')
    assert.ok(html.includes('SCRIBE-AUTHORED'), "report.html is the Scribe's page, not the mechanical renderer's")
    for (const title of TITLES) assert.ok(html.includes(title), `HTML carries ${title}`)
    const state = readState(engDir)
    assert.equal(state?.artifactSignoff?.by, 'scribe')
    const model = JSON.parse(readFileSync(join(engDir, 'report.json'), 'utf8')) as ReportModel
    assert.equal(model.artifactSignoff?.by, 'scribe')
    const events = readEvents(engDir)
    assert.ok(events.some(e => e.action === 'scribe_html_authored'))
    assert.ok(events.some(e => e.action === 'artifact_signed'))
    const gateOutcome = events.find(e => e.action === 'scribe_gate_outcome')
    assert.ok(gateOutcome, "the run records the scribe gate's returned outcome (L13)")
    assert.ok(gateOutcome.result.includes('signed after 1 review cycle'), "the recorded outcome carries the gate's verdict and cycles")
    assert.ok(existsSync(join(engDir, 'report-package.zip')), 'the package still ships')
  })

  it('(4) a refused sign-off no longer halts — the transition ships UNSIGNED and the run completes', async () => {
    const track = { reviews: 0, htmlAuthors: 0 }
    const res = await runEngagement(input, runOpts(e2eLlm({ refuseSignOff: true, track })))
    // Q-NOHALT: a coordinator that will not commit stops the SIGNATURE, never
    // the engagement. The run finishes; the record names the unsigned transition.
    assert.equal(res.status, 'complete', 'a refused sign-off must not halt the engagement')
    const engDir = join(dir, res.engagementId)
    const events = readEvents(engDir)
    assert.ok(events.some(e => e.action === 'signoff_unsigned'), 'the unsigned transition is recorded')
  })

  it('(5e) the review seat throws: the run still completes, UNSIGNED scribe_unavailable', async () => {
    const res = await runEngagement(input, runOpts(e2eLlm({ reviewThrows: true })))
    assert.equal(res.status, 'complete', 'a dead review seat never blocks the close')
    assert.equal(res.deliverableFailed, undefined)
    const engDir = join(dir, res.engagementId)
    const state = readState(engDir)
    assert.equal(state?.artifactUnsigned?.reason, 'scribe_unavailable')
    assert.equal(state?.artifactSignoff, null)
    const model = JSON.parse(readFileSync(join(engDir, 'report.json'), 'utf8')) as ReportModel
    assert.equal(model.artifactUnsigned?.reason, 'scribe_unavailable')
  })
})

describe('fleet assembly — the publisher seat', () => {
  const FIXTURE_RECORD: VerifiedEngagementRecord = {
    engagementId: 'eng-fixture-1',
    operator: 'Fixture Operator',
    owner: 'Fixture Owner LLC',
    proofMethod: 'DNS TXT ownership proof (fixture)',
    recordId: 'eng-fixture-1',
    verifiedAt: '2026-11-01T00:00:00.000Z',
    targets: ['app.example.com', 'example.com'],
    outOfScope: ['staging.example.com'],
    accessLevel: 'verified-domain',
    roe: 'Mode: RED. Scope: app.example.com, example.com.',
    sessionsAllowed: true,
  }
  const fleetCtx = (): PromptContext => ({
    mode: 'red',
    objective: 'assess the fixture attack surface',
    target: 'example.com',
    scopeHosts: ['app.example.com', 'example.com'],
    roe: { scope: ['app.example.com', 'example.com'], outOfScope: ['staging.example.com'] },
    fleet: { record: FIXTURE_RECORD },
  })

  it('(6) the publisher pack carries the scribe soul, both report skills in full, and the cycle knob', () => {
    const prompt = publisherPrompt(fleetCtx())
    const masterAt = prompt.indexOf('<identity>')
    const soulAt = prompt.indexOf('# The SCRIBE')
    const injectionAt = prompt.indexOf('<verified_engagement>')
    const knobsAt = prompt.indexOf('SCRIBE_MAX_CYCLES = 2')
    const seatAt = prompt.indexOf('# Publisher — the SCRIBE')
    const gradingAt = prompt.indexOf('<skill_content name="findings-grading-reporting">')
    const designAt = prompt.indexOf('<skill_content name="html-report-design">')
    assert.equal(masterAt, 0, 'the master block opens the assembled prompt')
    assert.ok(soulAt > masterAt, 'the scribe soul follows the master')
    assert.ok(injectionAt > soulAt, 'the engagement injection follows the soul')
    assert.ok(knobsAt > injectionAt, 'the SCRIBE_MAX_CYCLES knob rides the knobs block')
    assert.ok(seatAt > knobsAt, 'the publisher seat delta follows the knobs')
    assert.ok(gradingAt > seatAt, 'the grading/reporting skill body is bound in full')
    assert.ok(designAt > gradingAt, 'the HTML design skill body is bound in full')
    assert.ok(prompt.includes('gauge'), "the design skill's motion system rides the pack")
  })

  it("(6b) the other seats' packs are unchanged by the new seat", () => {
    const reporter = reporterPrompt(fleetCtx())
    assert.ok(reporter.includes('# The ARCHITECT'), 'the reporter still wears the architect soul')
    assert.ok(reporter.includes('# Reporter — TRINITY'), 'the reporter seat delta is untouched')
    assert.ok(!reporter.includes('# The SCRIBE'), 'no scribe soul leaks into the reporter pack')
    assert.ok(!publisherPrompt(fleetCtx()).includes('# The ARCHITECT'), 'no architect soul leaks into the publisher pack')
  })
})
