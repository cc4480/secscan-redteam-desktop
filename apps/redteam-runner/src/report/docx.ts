/**
 * Q-RP-2 — the editable DOCX copy of the engagement report, emitted as
 * report.docx alongside report.html from the SAME structured input
 * (html/render.ts's EngagementReportInput) — never by scraping HTML.
 * Contents mirror the HTML cover and finding anatomy: front matter,
 * the anchored grade, the §5 business-impact band, findings grouped by
 * truth tier with Severity / CVSS / CWE / Evidence / Impact /
 * Remediation, and the ranked priority actions. Per-finding reference
 * data (CVSS/CWE) renders only where the record carries it — the same
 * honesty rule as the HTML chips. The proof apparatus (Cell Receipts,
 * reverify commands) stays in the HTML twin; this is the editable copy.
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
import { severityRank, tierOf } from './html/cards.js'
import { SEVERITY_ORDER, TIER_LABEL, TIER_ORDER, type ReportTier } from './html/tokens.js'
import {
  CONTENT_TYPES_XML, DOC_RELS_XML, RELS_XML, STYLES_XML,
  documentXml, heading, labelledBlock, para, type RunSeg,
} from './docx-xml.js'

function metaLine(label: string, value: string): string {
  return para([{ text: `${label}: `, bold: true }, { text: value }])
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

/** Assemble report.docx (the OOXML zip bytes) from the report model. */
export function buildReportDocx(o: EngagementReportInput): Uint8Array {
  const m = o.meta
  const halted = typeof o.haltedReason === 'string' && o.haltedReason.length > 0
  const byTier = new Map<ReportTier, Finding[]>()
  for (const f of o.findings) {
    const tier = tierOf(f, o.bundles.get(f.id))
    byTier.set(tier, [...(byTier.get(tier) ?? []), f])
  }
  for (const list of byTier.values()) {
    list.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id))
  }
  const killedTitles = new Set(
    (byTier.get('ruled-out') ?? []).map((f) => f.title.trim().toLowerCase()),
  )
  const extraNegatives = o.negativeProof.filter(
    (n) => !killedTitles.has(n.hypothesis.trim().toLowerCase()),
  )
  const count = (t: ReportTier): number =>
    (byTier.get(t) ?? []).length + (t === 'ruled-out' ? extraNegatives.length : 0)

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
  if (halted) {
    body.push(para('Grade N/A — engagement halted.'))
    body.push(para(o.haltedReason as string))
  } else {
    body.push(para([
      { text: 'Grade: ', bold: true },
      { text: `${o.posture.grade} (${o.posture.score}/100) — ${o.posture.postureRating}` },
    ]))
  }
  const sev = o.posture.findingsBySeverity as Record<string, number>
  body.push(para(SEVERITY_ORDER.map((s) => `${sev[s] ?? 0} ${s}`).join(' · ')))
  body.push(para(
    `${count('proven')} proven · ${count('confirmed')} confirmed · ` +
    `${count('deferred')} deferred · ${count('ruled-out')} ruled out`,
  ))
  if (o.banner && !halted) {
    body.push(para([{ text: o.banner.title, bold: true }]), para(o.banner.message))
  }

  const d = o.detail
  if (d) {
    body.push(heading('Business Impact', 1), para(d.impact.text))
  }

  body.push(heading('Findings', 1))
  if (o.findings.length === 0 && extraNegatives.length === 0) {
    body.push(para('No findings were confirmed in this engagement.'))
  }
  for (const tier of TIER_ORDER) {
    const list = byTier.get(tier) ?? []
    const negs = tier === 'ruled-out' ? extraNegatives : []
    if (list.length === 0 && negs.length === 0) continue
    body.push(heading(`${TIER_LABEL[tier]} — ${count(tier)}`, 2))
    for (const f of list) body.push(...findingParas(o, f, tier))
    for (const n of negs) {
      body.push(heading(n.hypothesis, 3))
      body.push(...labelledBlock('Decisive observation', n.killingObservation))
    }
  }

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
    { level: 6, mtime: new Date('1980-01-01T00:00:00.000Z') },
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
