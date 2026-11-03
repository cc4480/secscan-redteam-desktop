/**
 * Q-NOHALT — the one close used by every non-completion end of a run.
 * Extracted from phases/run.ts for the file budget; the behaviour is
 * unchanged.
 *
 * It writes the mechanical accountability artifacts (safety manifest, item
 * verdicts, proof bundles, report) from the work already recorded, WITHOUT
 * re-running the reporter LLM, and verifies the deliverable set. A `halted`
 * close is reserved for a deliberate safety stop; every other end — provider
 * outage, refused preflight, internal fault — closes as `blocked`/incomplete
 * so the scan record is never discarded.
 */
import { join } from 'node:path'
import { type Ctx } from '../context.js'
import { type EventLog } from '../events.js'
import { fireSlack, reportPhase } from '../report.js'
import { finalizeDeliverables } from '../report/deliverables.js'
import { type EngagementResult, type Finding } from '../types.js'

export interface CloseIncompleteArgs {
  ctx: Ctx
  events: EventLog
  /** The engagement directory (report.md lands here). */
  dir: string
  engagementId: string
  brief: string
  summary: string
}

export async function closePhaseIncomplete(
  args: CloseIncompleteArgs,
  reason: string,
  kind: 'blocked' | 'halted',
): Promise<EngagementResult> {
  const { ctx, events, dir, engagementId, brief, summary } = args
  events.updateState({ status: kind, phase: kind === 'halted' ? 'halted' : 'report', blockedReason: reason })
  events.append({
    phase: kind === 'halted' ? 'halted' : 'report',
    actor: 'runner',
    action: kind === 'halted' ? 'engagement_halted' : 'engagement_closed_incomplete',
    result: reason,
  })
  void fireSlack(ctx, { kind: 'halted', reason })
  let findings: Finding[] = events.snapshot.findings
  let reportPath: string | undefined
  try {
    findings = await reportPhase(ctx, brief, summary, kind === 'halted' ? { haltedReason: reason } : { blockedReason: reason })
    reportPath = join(dir, 'report.md')
  } catch (reportErr) {
    events.append({ phase: 'report', actor: 'runner', action: 'incomplete_report_failed', result: `Could not write incomplete-end artifacts: ${(reportErr as Error).message}` })
  }
  const delivered = finalizeDeliverables(ctx)
  return { engagementId, status: kind, blockedReason: reason, reportPath, findings, deliverables: delivered.paths, ...(delivered.ok ? {} : { deliverableFailed: true as const }) }
}
