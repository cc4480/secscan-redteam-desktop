/**
 * Report phase orchestrator (v0.19.0 refactor — extracted from report.ts).
 *
 * reportPhase drives the publisher seat (the Scribe — report authorship
 * moved from the reporter seat in the 2026-11-01 seat change), reconciles
 * battery coverage (cells + per-item ledger), and assembles report.md from
 * runner-computed sections (proof bundles, item reconciliation,
 * integrations). Artifact writers: ./safety.ts, ./compliance.ts, ./proof.ts.
 */
import { writeFileSync } from 'node:fs'
import { groupNotApplicable, renderNotApplicable } from './grouping.js'
import { join } from 'node:path'
import { publisherPrompt } from '../prompts.js'
import { type Finding } from '../types.js'
import { type Ctx } from '../context.js'
import { agentLoop, promptCtx } from '../agents.js'
import { extractJsonBlock } from '../util.js'
import { PocBundle } from '../proof/index.js'
import { resolveOperatorName } from '../accountability/index.js'
import { countVariants, variantCountLine, variantProgressSuffix } from '../variants/index.js'
import { nucleiCountLine } from '../nuclei/index.js'
import { buildProofSection } from './proof.js'
import { buildIntegrationsSection } from './integrations.js'
import { buildActivitySection } from './activity.js'
import { readEvents } from '../events.js'
import { writeSafetyArtifacts } from './safety.js'
import { writeComplianceArtifacts } from './compliance.js'
import { extractNarrative } from './narrative.js'
import { buildEngagementMeta, type ReportMeta } from './html.js'
import { type EngagementReportInput } from './html/render.js'
import { resolveReportHtml } from './scribe-html.js'
import { buildEngagementReportInput, buildFindingMeta } from './html/wire.js'
import { emitDeliverables, stampFindingRefs } from './finding-refs.js'
import { buildDetailInput, recordReportMeta } from './predecessor.js'
import { type DetailInput } from './detail.js'
import { buildGradeSection, gradeFindings } from './grading.js'
import { applyCellVerdicts, haltedFindingFromLive, mergeReporterFindings } from './cell-verdicts.js'
import { incompleteEndHeader } from './incomplete-end.js'
import { isCoverageComplete } from './completeness.js'
import { peerDeferredPromptSection, peerVerdictSuffix, stampPeerVerdicts } from './peer-verdicts.js'
import { computeBatteryStatus } from './phase-battery.js'

export { applyCellVerdicts, haltedFindingFromLive, mergeReporterFindings } from './cell-verdicts.js'

export async function reportPhase(
  ctx: Ctx,
  reconBrief: string,
  exploitSummary: string,
  opts: { haltedReason?: string; blockedReason?: string } = {},
): Promise<Finding[]> {

  const { batteryLine, fbStatus, fbPlanOnly, lsum, nonCleanItems, pendingKeys } = computeBatteryStatus(ctx)

  let reportMd: string
  let findings: Finding[]
  if (opts.haltedReason || opts.blockedReason) {
    // Never call the seat LLM here — it could re-hit the same cap and lose the
    // accountability record exactly when it matters most.
    reportMd = incompleteEndHeader(ctx, opts.haltedReason ?? opts.blockedReason ?? 'incomplete', Boolean(opts.blockedReason))
    findings = ctx.liveFindings.map((lf, i) => haltedFindingFromLive(lf, i))
    stampPeerVerdicts(findings, ctx)
  } else if (ctx.config.dryRunAgents) {
    reportMd = `# Engagement report (dry-run)\n\nTarget: ${ctx.input.target}\nMode: ${ctx.input.mode}\n`
    findings = []
  } else {
    reportMd = await agentLoop(
      ctx,
      'reporter',
      'report',
      publisherPrompt(promptCtx(ctx)),
      `Write the client report now.\n\nAuthorization: ${ctx.verificationProof}\n\nOperation plan: ${JSON.stringify(ctx.plan)}\n\nShared verdicts this engagement — confirmed (${ctx.liveFindings.length}):\n${ctx.liveFindings.map(f => `- [${f.severity}] ${f.title} (${f.attackId}${f.vulnClass ? `, ${f.vulnClass}` : ''}${f.cellState ? `, cell: ${f.cellState.toUpperCase()}` : ''}${peerVerdictSuffix(f)}): ${f.evidence}`).join('\n') || '(none)'}\nKilled hypotheses (${ctx.killedLive.length}):\n${ctx.killedLive.map(k => `- ${k.hypothesis} → ${k.killingObservation}`).join('\n') || '(none)'}\n${peerDeferredPromptSection(ctx.peerDeferredLive)}Registry hits consulted: ${ctx.registryHits.length}. Target fingerprint: ${JSON.stringify(ctx.fingerprint)}.\n\n${batteryLine}\n\nRecon brief:\n${reconBrief.slice(0, 4000)}\n\nExploitation summary:\n${exploitSummary.slice(0, 4000)}\n\nProof of exploitation is appended mechanically by the runner from the audit log — do not invent PoC details, marker values, or reproduction steps in your narrative; describe findings only from the evidence given.\n\nEnd the report with a JSON block: \`\`\`json {"findings": [{"id":"F-1","severity":"low","title":"...","attackIds":["T1190"],"evidence":"...","fix":"...","retest":"...","status":"confirmed"}]} \`\`\``,
      [],
      4,
    )
    const parsed = extractJsonBlock(reportMd) as { findings?: Finding[] } | null
    // H3: the findings set is built from the live record — the reporter
    // JSON supplies prose only (mergeReporterFindings in cell-verdicts);
    // unmatched reporter items are dropped and logged, never silently.
    findings = mergeReporterFindings(ctx.liveFindings, Array.isArray(parsed?.findings) ? parsed.findings : [], (dropped) => {
      ctx.events.append({ phase: 'report', actor: 'runner', action: 'report_finding_dropped', result: `Reporter finding "${dropped.title}" matches no live finding — excluded from the record.` })
    })
    // Attribution is runner-stamped by the joins below, never model-set.
    for (const f of findings) { delete f.producer; delete f.peerReview }
    // Q-PROVEN: join the parsed findings back to the live findings so the
    // cell verdict reaches the report (before the accountable stamp below).
    applyCellVerdicts(findings, ctx.liveFindings)
    stampPeerVerdicts(findings, ctx)
  }
  // v0.17.0 accountability: every finding records the named human
  // accountable for it. Stamped mechanically by the runner at report time —
  // the reporter agent cannot set or change it.
  {
    const accountable = resolveOperatorName(ctx.input.operatorName, process.env) ?? '(operator name not supplied — set REDTEAM_OPERATOR)'
    for (const f of findings) f.accountableOperator = accountable
  }
  stampFindingRefs(findings, ctx.liveFindings)
  // The unified operation narrative ("Megazord"): the Scribe writes it first as plain paragraphs; the runner extracts it.
  const narrative = extractNarrative(reportMd)
  if (narrative) {
    ctx.operationNarrative = narrative
    ctx.events.updateState({ operationNarrative: narrative })
  }
  // Snapshot for the HTML executive-summary slot: the narrative before appends.
  const narrativeSource = reportMd
  // Runner-computed facts are appended deterministically — never trusted to the model.
  reportMd += `\n\n---\n\n## Battery coverage (runner-computed)\n\n${batteryLine}\n`
  // The one completeness predicate (report/completeness.ts) decides whether a
  // grade may issue at all. A battery with pending verdicts has not concluded,
  // so a letter grade over it would state more than the run supports — the
  // defect this predicate was written for and, until now, was not wired into.
  const coverageTotals = {
    total: lsum.total,
    confirmed: lsum.confirmed,
    executedClean: lsum.executedClean,
    killed: lsum.killed,
    blocked: lsum.blocked,
    na: lsum.na,
    pending: lsum.pending,
  }  // The engagement grade: the runner's local anchored scoring
  // is the runner's one grading voice (report/grading.ts) — deterministic,
  // computed here from the final confirmed findings, never the model's —
  // and never issued for a halted/blocked end (N/A, as the HTML cover renders).
  {
    const posture = gradeFindings(findings)
    reportMd += `\n---\n\n${(opts.haltedReason || opts.blockedReason || !isCoverageComplete(coverageTotals)) ? `## Security grade — SecScan (anchored scoring)\n\n**Grade N/A** — engagement ${opts.blockedReason ? 'blocked' : 'halted'}; no grade is issued for an incomplete engagement.\n` : buildGradeSection(findings)}`
    ctx.events.append({
      phase: 'report',
      actor: 'runner',
      action: 'report_grade',
      result: opts.haltedReason || opts.blockedReason ? `Security grade N/A — engagement ${opts.blockedReason ? 'blocked' : 'halted'}; no grade issued for an incomplete engagement.` : `Security grade ${posture.grade} (${posture.score}/100, ${posture.postureRating}) over ${posture.activeCount} confirmed finding(s) — SecScan anchored scoring.`,
    })
  }
  // v0.21.0 nuclei: honest counting — template executions are variant-level
  // checks, printed whenever nuclei ran (not only full-battery), reported
  // separately from intents, never merged.
  const ncAny = nucleiCountLine(ctx.nuclei)
  if (ncAny) reportMd += `\n${ncAny}\n`
  const pocBundleMap = new Map<string, PocBundle>()
  const proofData = buildProofSection(ctx, findings, pocBundleMap)
  reportMd += proofData.markdown
  // v0.18.0 per-item verdicts: the item reconciliation section — every
  // battery item's disposition, derived from the ledger (audit log +
  // verdict tools), never hand-waved. Full ledger: item-verdicts.json.
  const itemsMark = reportMd.length
  if (ctx.input.fullBattery && ctx.itemLedger.size > 0) {
    reportMd += '\n---\n\n## Item reconciliation (runner-computed)\n\n'
    reportMd +=
      'Every battery item carries exactly one verdict this engagement. ' +
      'The battery counts complete only when no item is pending.\n\n'
    reportMd +=
      `**${lsum.total} items:** ${lsum.confirmed} confirmed · ${lsum.executedClean} executed-clean · ` +
      `${lsum.killed} killed · ${lsum.blocked} blocked · ${lsum.na} not-applicable · ${lsum.pending} pending.\n\n`
    // v0.20.0 variants: honest counting — intents vs executions, two
    // numbers, never merged into one inflated figure.
    const vc = countVariants(ctx.itemLedger)
    if (vc.itemsWithVariants > 0) {
      reportMd += `${variantCountLine(vc)}\n\n`
    }
    if (nonCleanItems.length > 0) {
      // Not-applicable items are grouped by target and reason; everything else
      // is listed individually. A scoped engagement marks hundreds of items na
      // with one family-level reason each, and listing them one per line buried
      // the actual findings under 338 repetitions of the same sentence. The full
      // ids remain in item-verdicts.json — see report/grouping.ts.
      const naItems = nonCleanItems.filter(v => v.disposition === 'na')
      const otherItems = nonCleanItems.filter(v => v.disposition !== 'na')
      for (const v of otherItems) {
        reportMd += `- **${v.key}** [${v.disposition}]${variantProgressSuffix(v)} ${v.name}${v.reason ? ` — ${v.reason}` : ''}\n`
      }
      if (naItems.length > 0) reportMd += `\n${renderNotApplicable(groupNotApplicable(naItems))}\n`
      reportMd += '\n'
    }
    if (pendingKeys.length > 0) {
      reportMd +=
        `**Battery NOT complete:** ${pendingKeys.length} items still pending a verdict ` +
        `(${pendingKeys.slice(0, 50).join(', ')}${pendingKeys.length > 50 ? '…' : ''}). ` +
        'See Honest limits.\n'
    }
  }
  const reportEvents = readEvents(ctx.events.dir, 0, 100000)
  reportMd += buildActivitySection(reportEvents)
  const integrationsMd = await buildIntegrationsSection(ctx, findings, pocBundleMap)
  reportMd += integrationsMd
  // report.md + findings.csv are written after the HTML input exists
  // (below): both render from the ONE report document when it built;
  // the legacy assembly above is the fallback when it could not.
  let reportInput: EngagementReportInput | undefined
  try {
    const totals = {
      total: lsum.total,
      confirmed: lsum.confirmed,
      executedClean: lsum.executedClean,
      killed: lsum.killed,
      blocked: lsum.blocked,
      na: lsum.na,
      pending: lsum.pending,
    }
    const cells = fbStatus.map(({ t, c, s }) => ({ target: t, category: c, state: s }))
    // Q-REPORT-DETAIL: record the posture of record, resolve the
    // predecessor, assemble the detail input (additive — see catch).
    let detailInput: DetailInput | undefined
    let baselineMeta: ReportMeta['baseline']
    try {
      recordReportMeta(ctx, opts.haltedReason || opts.blockedReason ? null : gradeFindings(findings))
      const assembled = buildDetailInput({
        ctx, findings, bundles: pocBundleMap, totals, cells,
        findingMeta: buildFindingMeta(pocBundleMap, findings),
        planOnly: fbPlanOnly, events: reportEvents,
      })
      detailInput = assembled.input
      baselineMeta = assembled.baselineMeta
    } catch (err) {
      ctx.events.append({ phase: 'report', actor: 'runner', action: 'report_detail_failed', result: `Detail derivations skipped (HTML unaffected): ${(err as Error).message}` })
    }
    const meta = buildEngagementMeta(ctx, findings, totals)
    if (baselineMeta) meta.baseline = baselineMeta
    reportInput = buildEngagementReportInput({
      ctx,
      meta,
      title: 'Penetration Test Report',
      findings,
      narrativeMd: narrativeSource,
      bundles: pocBundleMap,
      proof: proofData,
      cells,
      totals,
      planOnly: fbPlanOnly,
      events: reportEvents,
      haltedReason: opts.haltedReason,
      blockedReason: opts.blockedReason,
      detailInput,
    })
    writeFileSync(join(ctx.events.dir, 'report.html'), await resolveReportHtml(ctx, reportInput))
    ctx.events.append({ phase: 'report', actor: 'runner', action: 'report_html_written', result: 'HTML report written alongside report.md.' })
  } catch (err) {
    ctx.events.append({ phase: 'report', actor: 'runner', action: 'report_html_failed', result: `HTML report generation failed (report.md unaffected): ${(err as Error).message}` })
  }
  // Q-RP-2 + Q-RP-5 + Q-DELIVERABLES-AUTOFIRE + Q-REPORT-TEMPLATES: closing set — md/csv from the document, DOCX, twins, zip.
  emitDeliverables(ctx, reportInput, {
    findings,
    totals: lsum,
    cells: fbStatus,
    haltedReason: opts.haltedReason,
    blockedReason: opts.blockedReason,
  },
  {
    legacyMd: reportMd,
    findings,
    bundles: pocBundleMap,
    annexes: {
      batteryLine,
      nucleiLine: ncAny || undefined,
      itemsMd: reportMd.slice(itemsMark),
      proofMd: proofData.markdown,
      integrationsMd,
    },
  })
  ctx.events.append({ phase: 'report', actor: 'reporter', action: 'report_written', result: `Report written (${findings.length} findings parsed).` })
  const safetyManifest = writeSafetyArtifacts(ctx)
  // The end status decides whether an attestation may be issued at all.
  const endStatus = opts.blockedReason ? 'blocked' : opts.haltedReason ? 'halted' : ctx.config.dryRunAgents ? 'dry-run' : 'complete'
  writeComplianceArtifacts(ctx, findings, batteryLine, safetyManifest, endStatus)
  ctx.events.updateState({ findings })
  return findings
}
