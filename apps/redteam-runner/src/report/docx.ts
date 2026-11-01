/**
 * Q-RP-2 — the editable DOCX copy of the engagement report, emitted as
 * report.docx alongside report.html from the SAME structured input
 * (html/render.ts's EngagementReportInput) — never by scraping HTML.
 * Since Q-REPORT-TEMPLATES it renders the ONE shared report document
 * (report/document.ts) in the canonical anatomy — cover matter, the
 * anchored grade, executive summary, coverage, findings grouped by
 * truth tier with Severity / CVSS / CWE / Evidence / Impact /
 * Remediation, the consolidated fix prompt, priority actions, pillar
 * cards, strengths, surface, activity, the recorded frame, and
 * limitations — so the editable copy can no longer drift from the
 * flagship's structure or counts. Per-finding reference data (CVSS/CWE)
 * renders only where the record carries it — the same honesty rule as
 * the HTML chips. The proof apparatus (Cell Receipts, reverify
 * commands) stays in the HTML twin; this is the editable copy.
 *
 * Packaging: a fixed OOXML part set zipped with fflate (already in the
 * workspace dependency tree via session-log-export) at a fixed mtime,
 * so the same input produces byte-identical output.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { type Ctx } from '../context.js'
import { type Finding } from '../types.js'
import { type EngagementReportInput } from './html/render.js'
import { TIER_LABEL, type ReportTier } from './html/tokens.js'
import { buildReportDocument, type ReportDocument } from './document.js'
import {
  CONTENT_TYPES_XML, DOC_RELS_XML, RELS_XML, STYLES_XML,
  documentXml, heading, labelledBlock, para, type RunSeg,
} from './docx-xml.js'

function metaLine(label: string, value: string): string {
  return para([{ text: `${label}: `, bold: true }, { text: value }])
}

/** Narrative markdown → plain paragraphs: heading markers and fence
 * lines drop, the words stay the reporter's. */
function proseParas(md: string): string[] {
  return md
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#{1,6}\s+/gm, '').replace(/^```.*$/gm, '').trim())
    .filter((p) => p.length > 0)
    .map((p) => para(p.replace(/\s*\n\s*/g, ' ')))
}

function findingParas(o: EngagementReportInput, f: Finding, tier: ReportTier): string[] {
  const out: string[] = [heading(`${f.id} — ${f.title}`, 3)]
  const meta = o.findingMeta.get(f.id)
  const segs: RunSeg[] = [
    { text: 'Severity: ', bold: true }, { text: f.severity },
    { text: ' · Tier: ', bold: true }, { text: TIER_LABEL[tier] },
  ]
  if (typeof meta?.cvss === 'number') segs.push({ text: ' · CVSS: ', bold: true }, { text: meta.cvss.toFixed(1) })
  if (meta?.cwe) segs.push({ text: ' · CWE: ', bold: true }, { text: meta.cwe })
  if (meta?.category) segs.push({ text: ' · Category: ', bold: true }, { text: meta.category })
  if (meta?.owasp) segs.push({ text: ' · OWASP: ', bold: true }, { text: meta.owasp })
  if (f.attackIds.length > 0) segs.push({ text: ' · Refs: ', bold: true }, { text: f.attackIds.join(', ') })
  out.push(para(segs))
  if (f.evidence) out.push(...labelledBlock('Evidence', f.evidence))
  const impact = o.detail?.findingImpacts[f.id]
  if (impact) out.push(...labelledBlock('Impact', impact))
  if (f.fix) out.push(...labelledBlock('Remediation', f.fix))
  if (f.retest) out.push(para([{ text: 'Retest: ', bold: true }, { text: f.retest }]))
  if (f.accountableOperator) {
    out.push(para([{ text: 'Accountable: ', bold: true }, { text: f.accountableOperator }]))
  }
  return out
}

function detailParas(doc: ReportDocument): string[] {
  const d = doc.detail
  if (!d) return []
  const out: string[] = []
  if (d.breakdown.length > 0) {
    out.push(heading('Detailed Executive Breakdown', 2), ...d.breakdown.map((l) => para(l)))
  }
  out.push(heading('What Changed', 2))
  if (!d.diff || !d.baselineLabel) {
    out.push(para(
      `First recorded scan of this target by this engine — there is no earlier scan to diff against. ` +
      `This report is the baseline: the next scan of ${doc.meta.target} will be diffed against it.`))
  } else {
    const diff = d.diff
    out.push(para(
      `Since ${d.baselineLabel}: ${diff.newFindings.length} new · ${diff.resolved.length} resolved · ` +
      `${diff.worsened.length} worsened · ${diff.improved.length} improved · Δ findings ${diff.findingsDelta}`))
    for (const e of [...diff.newFindings, ...diff.resolved, ...diff.worsened, ...diff.improved]) {
      out.push(para(`[${e.severity}] ${e.title}${e.note ? ` — ${e.note}` : ''}`))
    }
  }
  if (d.actionableCount > 0 && d.riskAreas.length > 0) {
    out.push(heading('Key Risk Areas', 2))
    for (const a of d.riskAreas) {
      out.push(para([{ text: `${a.name}: `, bold: true },
        { text: `${a.findings.length} finding(s) · worst ${a.worst} — ${a.findings.map((f) => `${f.title} (${f.id})`).join('; ')}` }]))
    }
  }
  out.push(heading('Business Impact', 2), para(d.impact.text))
  return out
}

/** Assemble report.docx (the OOXML zip bytes) from the report model. */
export function buildReportDocx(o: EngagementReportInput): Uint8Array {
  const doc = buildReportDocument(o)
  const m = o.meta
  const halted = typeof o.haltedReason === 'string' && o.haltedReason.length > 0
  const blocked = typeof o.blockedReason === 'string' && o.blockedReason.length > 0
  const tc = doc.tierCounts

  const body: string[] = [
    para(o.title, 'Title'),
    heading(m.target, 1),
    metaLine('Engagement', m.engagementId),
    metaLine('Status', m.status),
    metaLine('Mode', `${m.mode} · tier ${m.tier} · ${m.environment}`),
    metaLine('Authorisation', m.verified ? 'ownership verified' : 'not verified'),
  ]
  if (m.operator) body.push(metaLine('Operator', m.operator))
  if (m.client) body.push(metaLine('Client', m.client))
  body.push(metaLine('Started', m.startedAt), metaLine('Generated', m.generatedAt))
  if (m.objective) body.push(...labelledBlock('Objective', m.objective))

  body.push(heading('Security Grade', 1))
  if (halted || blocked) {
    body.push(para(`Grade N/A — engagement ${blocked ? 'blocked' : 'halted'}.`))
    body.push(para((blocked ? o.blockedReason : o.haltedReason) as string))
  } else {
    body.push(para([
      { text: 'Grade: ', bold: true },
      { text: `${o.posture.grade} (${o.posture.score}/100) — ${o.posture.postureRating}` },
    ]))
  }
  const sev = doc.severityCounts
  body.push(para(`critical ${sev.critical} · high ${sev.high} · medium ${sev.medium} · low ${sev.low} · info ${sev.info}`))
  body.push(para(
    `${tc.proven} proven · ${tc.confirmed} confirmed · ` +
    `${tc.deferred} deferred · ${tc['ruled-out']} ruled out`,
  ))
  if (o.banner && !halted && !blocked) {
    body.push(para([{ text: o.banner.title, bold: true }]), para(o.banner.message))
  }

  const narrative = o.narrativeMd.trim()
  if (narrative || o.detail) {
    body.push(heading('Executive Summary', 1))
    if (narrative) body.push(...proseParas(narrative))
    body.push(...detailParas(doc))
  }

  const c = o.coverage
  const t = c.totals
  body.push(heading('Coverage', 1))
  body.push(para(`${c.fullBattery ? 'Full battery' : 'Scoped run'} — ${c.cells.length} coverage cells: ` +
    c.cells.map((cell) => `${cell.target}:${cell.category} ${cell.state}`).join(' · ')))
  if (t.total > 0) {
    body.push(para(`${t.total} battery items: ${t.confirmed} confirmed · ${t.executedClean} executed-clean · ${t.killed} killed · ${t.blocked} blocked · ${t.na} not-applicable · ${t.pending} pending${c.probesUsed > 0 ? ` · ${c.probesUsed} probes` : ''}`))
  }
  const limits: string[] = []
  for (const cell of c.cells) if (cell.state === 'blocked') limits.push(`Blocked (prerequisite not met): ${cell.target}:${cell.category}`)
  for (const p of c.planOnly) limits.push(`Executes when its prerequisite is supplied: ${p}`)
  for (const n of c.notCovered) limits.push(`Not covered: ${n}`)
  if (limits.length) {
    body.push(heading('Honest limits', 2), ...limits.map((l) => para(`• ${l}`)))
  }

  body.push(heading('Findings', 1))
  if (o.findings.length === 0 && doc.tierGroups.length === 0) {
    body.push(para('No findings were confirmed in this engagement.'))
  }
  for (const g of doc.tierGroups) {
    body.push(heading(`${TIER_LABEL[g.tier]} — ${g.findings.length + g.negativeProof.length}`, 2))
    for (const f of g.findings) body.push(...findingParas(o, f, g.tier))
    for (const n of g.negativeProof) {
      body.push(heading(n.hypothesis, 3))
      body.push(...labelledBlock('Decisive observation', n.killingObservation))
    }
  }

  if (doc.fixPrompt) {
    body.push(heading('Complete Fix Prompt', 1))
    body.push(...doc.fixPrompt.split('\n').filter((l) => l.trim().length > 0).map((l) => para(l)))
  }

  const d = o.detail
  if (d && (d.priority.actions.length > 0 || d.priority.verifyNext.length > 0 || d.priority.zeroNote)) {
    body.push(heading('Priority Actions', 1))
    if (d.priority.zeroNote) {
      body.push(para(`1. No action required — ${d.priority.zeroNote}`))
    }
    d.priority.actions.forEach((e, i) => {
      body.push(para(`${i + 1}. Fix ${e.id} — ${e.title} (${e.severity}). ${e.fixSentence}`))
    })
    if (d.priority.verifyNext.length > 0) {
      body.push(heading('Verify next', 2))
      d.priority.verifyNext.forEach((e, i) => {
        body.push(para(`${i + 1}. Verify ${e.id} — ${e.title} (${e.severity}). ${e.fixSentence}`))
      })
    }
  }
  if (d && d.pillars.length > 0) {
    body.push(heading('Pillar Coverage', 1))
    for (const p of d.pillars) {
      body.push(para([{ text: `${p.pillar} (${p.scopeLabel}): `, bold: true },
        { text: `${p.status}${p.status === 'FINDINGS' ? ` ${p.findingCount}` : ''}${p.reason ? ` — ${p.reason}` : ''}` }]))
    }
  }
  if (o.matter?.strengths) {
    body.push(heading('What Is Working Well', 1), para(o.matter.strengths.summary),
      ...o.matter.strengths.areaLines.map((l) => para(`• ${l}`)))
  }
  if (d && ((d.surfaceNetwork && d.surfaceNetwork.length > 0) || d.surfaceDynamic.length > 0)) {
    body.push(heading('Surface & Coverage Detail', 1))
    for (const r of [...(d.surfaceNetwork ?? []), ...d.surfaceDynamic]) {
      body.push(para([{ text: `${r.label}: `, bold: true }, { text: r.value }]))
    }
  }
  if (o.activity.eventCount > 0) {
    body.push(heading('Tool Activity', 1),
      para(`${o.activity.eventCount} events across ${o.activity.totalActions} distinct actions — the full table renders in report.html.`))
  }
  if (o.matter) {
    body.push(heading('Scope & Authorisation', 1))
    for (const r of [...o.matter.scopeRows, ...o.matter.authorisationRows]) {
      body.push(para([{ text: `${r.label}: `, bold: true }, { text: r.value }]))
    }
    body.push(heading('Method & Tooling', 1), ...o.matter.methodLines.map((l) => para(l)))
    body.push(heading('Risk Rating Method', 1), ...o.matter.riskMethodLines.map((l) => para(l)))
    body.push(heading('Limitations & Residual Unknowns', 1),
      ...o.matter.limitationLines.map((l) => para(`• ${l}`)))
  }

  body.push(
    para(`Generated ${m.generatedAt} · Engagement ${m.engagementId} · SecScan RedTeam`),
    para(
      'The full evidence record — report.html, report.md, proof bundles and ' +
      'item verdicts — ships in the engagement directory alongside this document.',
    ),
  )

  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
      '_rels/.rels': strToU8(RELS_XML),
      'word/document.xml': strToU8(documentXml(body)),
      'word/styles.xml': strToU8(STYLES_XML),
      'word/_rels/document.xml.rels': strToU8(DOC_RELS_XML),
    },
    // Local components, not UTC: fflate reads the mtime's LOCAL date parts, and 1980-01-01T00:00Z is still 1979 west of UTC.
    { level: 6, mtime: new Date(1980, 0, 1, 0, 0, 0) },
  )
}

/** Phase artifact writer (the writeSafetyArtifacts pattern): emit
 * report.docx beside report.html. Its own try/catch — a DOCX failure
 * is recorded as an event and never breaks the report itself. */
export function writeDocxArtifact(ctx: Ctx, input: EngagementReportInput): void {
  try {
    writeFileSync(join(ctx.events.dir, 'report.docx'), buildReportDocx(input))
    ctx.events.append({
      phase: 'report',
      actor: 'runner',
      action: 'report_docx_written',
      result: 'DOCX report written alongside report.html.',
    })
  } catch (err) {
    ctx.events.append({
      phase: 'report',
      actor: 'runner',
      action: 'report_docx_failed',
      result: `DOCX report generation failed (report.html unaffected): ${(err as Error).message}`,
    })
  }
}
