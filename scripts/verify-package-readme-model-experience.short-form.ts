/** The audited one-sentence Model Experience form. */

import { KV_CACHE_EFFECT_HEADING } from './verify-package-readme-model-experience.types.ts'
import type { Counters, Failure, Line, SentenceContract } from './verify-package-readme-model-experience.types.ts'

/**
 * Check one audited package's short Model Experience section and tally it.
 * @param readme - repository-relative README path failures name.
 * @param modelHeadingIndex - line index of the section's H2 heading.
 * @param content - the section's non-blank prose lines.
 * @param rawSection - the section's raw source lines.
 * @param contract - the audited sentence form this package must take.
 * @param counters - running tallies the successful form updates.
 * @param failures - failure list each problem is appended to.
 */
export function checkShortForm(
  readme: string,
  modelHeadingIndex: number,
  content: readonly Line[],
  rawSection: readonly string[],
  contract: SentenceContract,
  counters: Counters,
  failures: Failure[],
): void {
  const pattern = contract.kind === 'none' ? /^None, as .+\.$/ : /^Indirectly, through .+\.$/
  const rawContent = rawSection.filter(line => line.trim().length > 0)
  const sentence = content[0]
  const kvCacheHeading = content[1]
  const kvCacheEffect = content[2]
  if (content.length !== 3 || rawContent.length !== 3 || !pattern.test(sentence?.raw ?? '')) {
    const prefix = contract.kind === 'none' ? 'None, as ' : 'Indirectly, through '
    failures.push({ path: readme, message: `must contain exactly one sentence beginning ${JSON.stringify(prefix)} and ending with a period, followed by ${KV_CACHE_EFFECT_HEADING} and one non-empty paragraph` })
    return
  }
  if (kvCacheHeading?.raw !== KV_CACHE_EFFECT_HEADING
    || kvCacheEffect === undefined
    || /^#{1,6} /.test(kvCacheEffect.raw)
    || kvCacheEffect.raw.trim().length === 0) {
    failures.push({ path: readme, message: `line ${kvCacheHeading?.index ?? sentence?.index ?? modelHeadingIndex}: short Model Experience form requires exact ${KV_CACHE_EFFECT_HEADING} and one non-empty paragraph` })
    return
  }
  if (sentence === undefined
    || sentence.index !== modelHeadingIndex + 2
    || kvCacheHeading.index !== sentence.index + 2
    || kvCacheEffect.index !== kvCacheHeading.index + 2) {
    failures.push({ path: readme, message: 'short Model Experience sentence, KV-cache H4, and paragraph require one blank line between each element' })
    return
  }
  if (contract.kind === 'none') counters.explainedNoneCount += 1
  else counters.indirectCount += 1
  counters.kvCacheEffectCount += 1
}
