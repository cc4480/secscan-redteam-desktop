/**
 * Brief planning for `scripts/gen-translation-brief.ts`: choose the narrowest
 * safely mapped granularity per drifted side, and apply a mechanical splice
 * after structural validation.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { diffTexts, root } from './gen-translation-brief-git.ts'
import { isTranslationPairSource, terminology, type PairState } from './gen-translation-brief-pairs.ts'
import {
  changedSpanIndices,
  computeMechanicalUpdate,
  firstOccurrenceContext,
  markdownUnits,
  relevantTerminologyRows,
  renderTranslationBrief,
  sectionSpans,
  spansAligned,
  type BriefBundle,
  type BriefDirection,
  type BriefScope,
  type MarkdownSpan,
} from './translation-brief.ts'
import {
  parseTranslationMarkdown,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'

/** Assemble bundles for the given changed + first-occurrence span indices. */
function bundlesFor(
  indices: number[],
  extraIndices: number[],
  confirmed: MarkdownSpan[],
  current: MarkdownSpan[],
  counterpart: MarkdownSpan[],
): BriefBundle[] {
  const extras = new Set(extraIndices)
  return [...new Set([...indices, ...extraIndices])].sort((left, right) => left - right).map((index) => {
    const confirmedSpan = confirmed[index]
    const currentSpan = current[index]
    const counterpartSpan = counterpart[index]
    if (confirmedSpan === undefined || currentSpan === undefined || counterpartSpan === undefined) {
      throw new Error(`gen-translation-brief: span ${index} is unmapped despite alignment`)
    }
    return {
      index,
      label: currentSpan.label,
      reason: extras.has(index) && confirmedSpan.text === currentSpan.text ? 'first-occurrence' as const : undefined,
      confirmedSourceText: confirmedSpan.text,
      currentSourceText: currentSpan.text,
      counterpartText: counterpartSpan.text,
      counterpartStartLine: counterpartSpan.startLine,
    }
  })
}

/** One drifted side's chosen granularity and the text its terminology matches. */
interface PlannedBrief {
  scope: BriefScope
  /** Old + new text of the changed spans, for terminology matching. */
  changedText: string
  /** Computed counterpart for a mechanical scope, for `--apply`. */
  mechanicalResult?: string | undefined
}

/** Choose the narrowest safely mapped granularity for one drifted side. */
function planScope(
  sourceLast: string,
  sourceCurrent: string,
  counterpartCurrent: string,
  direction: BriefDirection,
  bothDrifted: boolean,
): PlannedBrief {
  const wholeChangedText = `${sourceLast}\n${sourceCurrent}`
  if (bothDrifted) {
    return {
      scope: { kind: 'document', reason: 'BOTH sides changed since the pair was last confirmed consistent, so no side is a trustworthy mapping anchor; decide which side owns each divergence.' },
      changedText: wholeChangedText,
    }
  }
  const mechanical = computeMechanicalUpdate(sourceLast, sourceCurrent, counterpartCurrent)
  if (mechanical !== undefined) {
    return { scope: { kind: 'mechanical' }, changedText: wholeChangedText, mechanicalResult: mechanical }
  }
  for (const [kind, spansOf] of [['units', markdownUnits], ['sections', sectionSpans]] as const) {
    const confirmed = spansOf(sourceLast)
    const current = spansOf(sourceCurrent)
    const counterpart = spansOf(counterpartCurrent)
    if (!spansAligned(confirmed, current) || !spansAligned(confirmed, counterpart)) continue
    const changed = changedSpanIndices(confirmed, current)
    if (changed.length === 0) continue
    const changedText = changed.map(index => `${confirmed[index]?.text ?? ''}\n${current[index]?.text ?? ''}`).join('\n')
    const rows = relevantTerminologyRows(terminology, direction, changedText)
    const occurrence = direction === 'en-to-zh'
      ? firstOccurrenceContext(sourceLast, sourceCurrent, confirmed, current, rows, new Set(changed))
      : { notes: [], extraSpanIndices: [] }
    return {
      scope: {
        kind,
        bundles: bundlesFor(changed, occurrence.extraSpanIndices, confirmed, current, counterpart),
        firstOccurrenceNotes: occurrence.notes,
      },
      changedText,
    }
  }
  return {
    scope: { kind: 'document', reason: 'Neither fine-grained units nor heading sections align one to one across the last-confirmed source, current source, and current counterpart.' },
    changedText: wholeChangedText,
  }
}

/** Validate a computed mechanical counterpart and write it. */
function applyMechanical(counterpartPath: string, sourceCurrent: string, result: string): void {
  const counterpartBase = basename(counterpartPath)
  const sourcePath = counterpartPath.endsWith('.zh.md')
    ? counterpartPath.replace(/\.zh\.md$/, '.md')
    : counterpartPath.replace(/\.md$/, '.zh.md')
  const sourceBase = counterpartBase.endsWith('.zh.md')
    ? counterpartBase.replace(/\.zh\.md$/, '.md')
    : counterpartBase.replace(/\.md$/, '.zh.md')
  const errors = translationStructureDiff(
    translationStructureSignature(
      parseTranslationMarkdown(sourceCurrent),
      counterpartBase,
      { repoRoot: root, sourcePath, isTranslationPairSource, markdown: sourceCurrent },
    ),
    translationStructureSignature(
      parseTranslationMarkdown(result),
      sourceBase,
      { repoRoot: root, sourcePath: counterpartPath, isTranslationPairSource, markdown: result },
    ),
  )
  if (errors.length > 0) {
    throw new Error(`gen-translation-brief: computed mechanical update for ${counterpartPath} violates the pair structure: ${errors.join('; ')}`)
  }
  writeFileSync(join(root, counterpartPath), result)
  console.error(`gen-translation-brief: applied code-fence splice to ${counterpartPath}; review the diff, then record the pair.`)
}

/** Render (and under `--apply`, apply) the briefing for one drifted side. */
export function briefDirection(pair: PairState, direction: BriefDirection, apply: boolean): string {
  const sourceIsEnglish = direction === 'en-to-zh'
  const sourcePath = sourceIsEnglish ? pair.anchor : pair.zh
  const counterpartPath = sourceIsEnglish ? pair.zh : pair.anchor
  const sourceLast = sourceIsEnglish ? pair.enLast : pair.zhLast
  const sourceCurrent = readFileSync(join(root, sourcePath), 'utf8')
  const counterpartCurrent = readFileSync(join(root, counterpartPath), 'utf8')
  const diff = diffTexts(sourceLast, sourceCurrent)
  const planned = planScope(sourceLast, sourceCurrent, counterpartCurrent, direction, pair.enDrifted && pair.zhDrifted)
  if (apply && planned.mechanicalResult !== undefined) {
    applyMechanical(counterpartPath, sourceCurrent, planned.mechanicalResult)
  }
  return renderTranslationBrief({
    sourcePath,
    counterpartPath,
    direction,
    diff,
    scope: planned.scope,
    terminology: relevantTerminologyRows(terminology, direction, planned.changedText),
  })
}
