/**
 * M6 artifact checks — split out of charter-completion.ts for the file
 * budget, with no behaviour change: the same phases are artifact-
 * producing, and the same response shapes satisfy the artifact check.
 */
import { type EngagementPhase } from './types.js'

/**
 * M6: the phases whose chartered calls must produce an artifact — the
 * report phase (the report document, the Scribe's authored HTML, the
 * scribe/peer-review verdict JSON). Every createCharteredComplete
 * caller that serves the report phase passes 'report' (report/phase.ts
 * via agentLoop, report/scribe.ts, report/scribe-html.ts,
 * phases/peer-review.ts), so the flag originates here, from the phase
 * the factory was built for, not from a per-call guess.
 *
 * @param phase - the phase a chartered completion serves
 * @returns true when that phase's calls are artifact-producing tasks
 */
export function isArtifactPhase(phase: EngagementPhase): boolean {
  return phase === 'report'
}

/**
 * M6: the default artifact check for an artifact phase's response: the
 * text carries a complete HTML document (Scribe-authored report.html),
 * a parseable JSON object (a whole-text verdict, or a fenced ```json
 * block — the report's findings block), or a markdown report heading.
 * Cooperative prose with none of these is not the artifact.
 *
 * @param text - the response text to check
 * @returns true when the text carries an artifact in a required format
 */
export function reportArtifactCheck(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  if (/<!DOCTYPE html/i.test(trimmed) && /<\/html>/i.test(trimmed)) return true
  const fenced = /```json\s*\n([\s\S]*?)```/.exec(trimmed)
  for (const candidate of [trimmed, fenced?.[1]?.trim() ?? '']) {
    if (!candidate.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return true
    } catch {
      // Not JSON — fall through to the remaining formats.
    }
  }
  return /^#{1,3}\s+\S/m.test(trimmed)
}

/**
 * M6: the phase-derived artifact check paired with {@link isArtifactPhase}.
 *
 * @param phase - the phase a chartered completion serves
 * @returns the artifact check for artifact phases, or undefined
 */
export function artifactCheckForPhase(phase: EngagementPhase): ((text: string) => boolean) | undefined {
  return isArtifactPhase(phase) ? reportArtifactCheck : undefined
}
