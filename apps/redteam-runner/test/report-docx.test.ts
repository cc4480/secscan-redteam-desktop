/**
 * Q-RP-2 (DOCX writer) + Q-RP-4 (per-finding Impact) — the DOCX twin is
 * built from the same report model as the HTML: the artifact must unzip
 * to a valid word/document.xml carrying the cover/front matter, the
 * anchored grade, and every finding with its Severity / CVSS / CWE /
 * Evidence / Impact / Remediation. Impact text is the mechanically
 * derived statement (report/detail-impact.ts) — present for findings
 * of record, absent for a deferred finding (nothing asserted before
 * verification). Fixtures are local to this suite.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import { buildReportDocx } from '../src/report/docx.js'
import { buildReportDetail, type DetailInput } from '../src/report/detail.js'
import { gradeBanner, gradeFindings } from '../src/report/grading.js'
import { type EngagementReportInput } from '../src/report/html/render.js'
import { type ReportMeta } from '../src/report/html.js'
import { type Finding } from '../src/types.js'
import { type PocBundle } from '../src/proof/index.js'

const meta: ReportMeta = {
  engagementId: 'eng-docx-fixture',
  target: 'https://secscan.us',
  mode: 'red',
  environment: 'production',
  tier: 1,
  operator: 'Carlos',
  client: 'SecScan',
  status: 'complete',
  phase: 'done',
  verified: true,
  objective: 'Assess the public surface',
  startedAt: '2026-10-28T09:00:00.000Z',
  generatedAt: '2026-10-28T10:00:00.000Z',
  findings: { critical: 1, high: 0, medium: 0, low: 2, info: 1 },
  battery: { total: 22, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 },
}

const findings: Finding[] = [
  { id: 'F-1', severity: 'critical', title: 'Cross-tenant object access (BOLA)', attackIds: ['T1190'], evidence: 'Object of another tenant returned without an ownership check.', fix: 'Enforce per-object authorization on every API read.', retest: 'Repeat with the second identity; expect 403.', status: 'confirmed', accountableOperator: 'Carlos' },
  { id: 'F-2', severity: 'low', title: 'Missing Content Security Policy header', attackIds: [], evidence: 'No CSP header on the app responses.', fix: 'Add a Content-Security-Policy header.', retest: 'Fetch the app root; expect the header.', status: 'confirmed', accountableOperator: 'Carlos' },
  { id: 'F-3', severity: 'info', title: 'robots.txt discloses hidden paths', attackIds: [], evidence: 'Disallow entries name internal paths.', fix: 'Remove internal paths from robots.txt.', retest: 'Fetch robots.txt; expect no internal paths.', status: 'confirmed', accountableOperator: 'Carlos' },
  { id: 'F-4', severity: 'low', title: 'Session cookie lifetime too long', attackIds: [], evidence: 'Flagged, awaiting verification.', fix: 'Verify first.', retest: 'n/a', status: 'deferred', accountableOperator: 'Carlos' },
]

const bundle: PocBundle = {
  version: 1,
  bundleId: 'b-1',
  engagementId: meta.engagementId,
  findingId: 'F-1',
  attackIds: ['T1190'],
  severity: 'critical',
  title: findings[0]!.title,
  target: meta.target,
  operator: 'Carlos',
  generatedAt: meta.generatedAt,
  steps: [],
  validationTier: 'execution',
  proves: 'The marker was executed and echoed by the target.',
  doesNotProve: 'It does not prove data beyond the canary was reachable.',
  reverifyCommand: 'node reverify.mjs --finding F-1',
}

const detailInput: DetailInput = {
  target: meta.target,
  mode: 'red',
  dryRun: false,
  posture: { score: 20, grade: 'F', postureRating: 'CRITICAL' },
  worstConfirmed: { id: 'F-1', severity: 'critical', title: findings[0]!.title },
  findingsBySeverity: { critical: 1, high: 0, medium: 0, low: 2, info: 1 },
  tierCounts: { proven: 1, confirmed: 2, deferred: 1 },
  findings: [
    { id: 'F-1', title: findings[0]!.title, severity: 'critical', tier: 'proven', attackIds: ['T1190'], sourceLabel: 'bola-idor', signals: [], fix: findings[0]!.fix },
    { id: 'F-2', title: findings[1]!.title, severity: 'low', tier: 'confirmed', attackIds: [], sourceLabel: 'Injection Defense', signals: ['WSTG-CONF-12', 'CWE-79'], fix: findings[1]!.fix },
    { id: 'F-3', title: findings[2]!.title, severity: 'info', tier: 'confirmed', attackIds: [], sourceLabel: 'Information Disclosure', signals: [], fix: findings[2]!.fix },
    { id: 'F-4', title: findings[3]!.title, severity: 'low', tier: 'deferred', attackIds: [], sourceLabel: 'weak-session', signals: [], fix: findings[3]!.fix },
  ],
  coverage: {
    totals: { total: 22, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 },
    probesUsed: 36,
    fullBattery: true,
    notCovered: ['credential_chain', 'stored_xss', 'llm'],
    planOnly: [],
    arms: [],
  },
  surface: { tlsGrade: 'A', servedVia: 'Cloudflare', technologies: ['Cloudflare'] },
}

function input(over: Partial<EngagementReportInput> = {}): EngagementReportInput {
  return {
    meta,
    title: 'Penetration Test Report',
    narrativeMd: 'The team mapped the surface and tested the tenant boundary.',
    posture: gradeFindings(findings),
    banner: gradeBanner(findings),
    findings,
    bundles: new Map([['F-1', bundle]]),
    noBundleReasons: new Map(),
    negativeProof: [],
    findingMeta: new Map([
      ['F-1', { category: 'validation', owasp: 'WSTG-ATHZ-04', cwe: 'CWE-639', cvss: 9.8 }],
      ['F-2', { cwe: 'CWE-79', cvss: 3.7 }],
    ]),
    detail: buildReportDetail(detailInput),
    coverage: {
      fullBattery: true,
      cells: [{ target: 'webapp', category: 'validation', state: 'done' }],
      totals: detailInput.coverage.totals,
      probesUsed: 36,
      planOnly: [],
      notCovered: ['credential_chain', 'stored_xss', 'llm'],
    },
    activity: { eventCount: 0, rows: [], totalActions: 0, decisions: [], danglingCauses: [] },
    ...over,
  }
}

/** Minimal XML well-formedness check: balanced tags, one root. */
function assertWellFormed(xml: string): void {
  const stack: string[] = []
  const tagRe = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<![^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  let m: RegExpExecArray | null
  let roots = 0
  while ((m = tagRe.exec(xml)) !== null) {
    if (m[2] === undefined) continue // declaration / comment / doctype
    const [, closing, name, , selfClose] = m
    if (closing) {
      assert.equal(stack.pop(), name, `closing </${name}> matches its opener`)
    } else if (!selfClose) {
      if (stack.length === 0) roots++
      stack.push(name!)
    }
  }
  assert.deepEqual(stack, [], 'every element closes')
  assert.equal(roots, 1, 'exactly one root element')
}

function docxText(bytes: Uint8Array): { parts: Record<string, string>; text: string } {
  const files = unzipSync(bytes)
  const parts: Record<string, string> = {}
  for (const [name, data] of Object.entries(files)) parts[name] = strFromU8(data)
  const xml = parts['word/document.xml'] ?? ''
  const text = xml
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
  return { parts, text }
}

describe('report docx (Q-RP-2)', () => {
  const bytes = buildReportDocx(input())
  const { parts, text } = docxText(bytes)

  it('unzips to the OOXML part set with a valid document.xml', () => {
    for (const name of [
      '[Content_Types].xml', '_rels/.rels', 'word/document.xml',
      'word/styles.xml', 'word/_rels/document.xml.rels',
    ]) {
      assert.ok(parts[name], `part ${name} present`)
    }
    assert.match(parts['word/document.xml']!, /^<\?xml version="1\.0"/)
    assertWellFormed(parts['word/document.xml']!)
    assertWellFormed(parts['word/styles.xml']!)
    assertWellFormed(parts['[Content_Types].xml']!)
  })

  it('carries the front matter and the anchored grade', () => {
    const posture = gradeFindings(findings)
    assert.ok(text.includes('Penetration Test Report'))
    assert.ok(text.includes('https://secscan.us'))
    assert.ok(text.includes('eng-docx-fixture'))
    assert.ok(text.includes('ownership verified'))
    assert.ok(text.includes(`Grade: ${posture.grade} (${posture.score}/100)`), 'the anchored grade, from the grading seam')
    assert.ok(text.includes('Material business risk: F-1 (Cross-tenant object access (BOLA))'), 'the §5 band renders')
  })

  it("carries every finding with Severity / CVSS / CWE / Evidence / Impact / Remediation", () => {
    for (const f of findings) assert.ok(text.includes(f.title), `title ${f.id}`)
    assert.ok(text.includes('CVSS: 9.8'), 'F-1 CVSS from the record')
    assert.ok(text.includes('CWE: CWE-639'), 'F-1 CWE from the record')
    assert.ok(text.includes('CVSS: 3.7'), 'F-2 CVSS from the record')
    assert.ok(text.includes('Object of another tenant returned without an ownership check.'), 'evidence verbatim')
    assert.ok(text.includes('Enforce per-object authorization on every API read.'), 'remediation verbatim')
    assert.ok(
      text.includes(
        'Demonstrated live against the target in this engagement (critical severity). ' +
        'Per-user data can be reached across account boundaries',
      ),
      "F-1's derived Impact statement",
    )
    assert.ok(
      text.includes('Confirmed against the target in this engagement (low severity). Browser-enforced protections'),
      "F-2's derived Impact statement",
    )
  })

  it('asserts no Impact for the deferred finding', () => {
    assert.ok(text.includes('Session cookie lifetime too long'), 'the deferred finding itself renders')
    assert.ok(
      !text.includes('The login and session surface accepts more attempts'),
      "the deferred finding's area clause is never asserted as its impact",
    )
  })

  it('is deterministic: the same input produces byte-identical output', () => {
    const again = buildReportDocx(input())
    assert.deepEqual(Buffer.from(again), Buffer.from(bytes))
  })

  it('a halted engagement renders the N/A grade state, never a number', () => {
    const halted = docxText(buildReportDocx(input({ haltedReason: 'kill switch engaged' })))
    assert.ok(halted.text.includes('Grade N/A — engagement halted.'))
    assert.ok(halted.text.includes('kill switch engaged'))
    assert.ok(!halted.text.includes('Grade: F'), 'no passing grade on a halted report')
  })
})
