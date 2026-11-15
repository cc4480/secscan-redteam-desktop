/**
 * Rendering of one pair's complete briefing: the sourced diff, the mapped
 * scope at its granularity, the binding terminology rows, and the rules
 * digest.
 */

import type { BriefDirection, TerminologyRow } from './translation-brief-terminology.ts'

/** Smallest fence of `mark` characters that safely wraps `body`. */
function fenceFor(body: string, mark: '`' | '~'): string {
  let longest = 2
  for (const line of body.split('\n')) {
    const run = new RegExp(`^\\s*(${mark === '`' ? '`' : '~'}{3,})`).exec(line)
    if (run?.[1] !== undefined && run[1].length > longest) longest = run[1].length
  }
  return mark.repeat(longest + 1)
}

/** One changed (or first-occurrence) span with its three-way context. */
export interface BriefBundle {
  /** Span index shared by the aligned documents. */
  index: number
  /** Human label: heading text or node type. */
  label: string
  /** Why the bundle is present when its source text did not change. */
  reason?: 'first-occurrence' | undefined
  confirmedSourceText: string
  currentSourceText: string
  counterpartText: string
  /** 1-based line the counterpart span starts on. */
  counterpartStartLine: number
}

/** The granularities a briefing can map the change at, narrowest first. */
export type BriefScope =
  | { kind: 'mechanical' }
  | { kind: 'units'; bundles: BriefBundle[]; firstOccurrenceNotes: string[] }
  | { kind: 'sections'; bundles: BriefBundle[]; firstOccurrenceNotes: string[] }
  | { kind: 'document'; reason: string }

/** Inputs for rendering one pair's briefing. */
export interface TranslationBriefInput {
  /** Repo-relative path of the side that changed. */
  sourcePath: string
  /** Repo-relative path of the counterpart to update. */
  counterpartPath: string
  direction: BriefDirection
  /** Unified diff of the changed side, last-confirmed to current. */
  diff: string
  scope: BriefScope
  terminology: TerminologyRow[]
}

const ZH_TARGET_DIGEST = [
  '- Edit ONLY what the change requires; preserve the reviewed phrasing of everything unchanged.',
  '- Nothing added, nothing dropped: the Chinese must state exactly what the new English states.',
  '- Write natural institutional technical Chinese, not word-by-word gloss; terse stays terse.',
  '- Code fences byte-identical to the English side, comments included; inline code spans verbatim.',
  '- Repository-relative document links keep the same semantic target and exact query/fragment; targets in the active bilingual corpus use `.zh.md` for Chinese, a missing in-scope counterpart is an error, and targets outside the corpus keep the authored path. The switcher remains the cross-locale exception.',
  '- Structure mirrors the counterpart: heading depths and order, list kinds and item counts, table rows and columns.',
  '- 首次出现 annotations attach to the document-wide first occurrence only; later occurrences use the bare form, and an empty 首次出现 cell means never gloss.',
  '- Typography: one half-width space between Chinese and Latin or digits; full-width punctuation in Chinese prose; 顿号 for enumerations; second person is 你.',
  '- One physical line per paragraph; exactly one trailing newline.',
]

const EN_TARGET_DIGEST = [
  '- Edit ONLY what the change requires; preserve the reviewed phrasing of everything unchanged.',
  '- Nothing added, nothing dropped: the English must state exactly what the new Chinese states.',
  '- Write concise professional developer prose, not word-by-word gloss; terse stays terse.',
  '- Code fences byte-identical to the Chinese side, comments included; inline code spans verbatim.',
  '- Repository-relative document links keep the same semantic target and exact query/fragment; targets in the active bilingual corpus use `.md` for English, a missing in-scope counterpart is an error, and targets outside the corpus keep the authored path. The switcher remains the cross-locale exception.',
  '- Structure mirrors the counterpart: heading depths and order, list kinds and item counts, table rows and columns.',
  '- One physical line per paragraph; exactly one trailing newline.',
]

function renderBundles(out: string[], input: TranslationBriefInput, bundles: BriefBundle[], firstOccurrenceNotes: string[]): void {
  const sourceLanguage = input.direction === 'en-to-zh' ? 'English' : 'Chinese'
  const counterpartLanguage = input.direction === 'en-to-zh' ? 'Chinese' : 'English'
  for (const bundle of bundles) {
    out.push('')
    out.push(`### #${bundle.index} ${bundle.label}${bundle.reason === 'first-occurrence' ? ' — unchanged; included for a first-occurrence move' : ''} — counterpart at ${input.counterpartPath}:${bundle.counterpartStartLine}`)
    const fence = fenceFor([bundle.confirmedSourceText, bundle.currentSourceText, bundle.counterpartText].join('\n'), '~')
    if (bundle.confirmedSourceText !== bundle.currentSourceText) {
      out.push('')
      out.push(`Last-confirmed ${sourceLanguage}:`)
      out.push('')
      out.push(`${fence}markdown`)
      out.push(bundle.confirmedSourceText.trimEnd())
      out.push(fence)
    }
    out.push('')
    out.push(`Current ${sourceLanguage}:`)
    out.push('')
    out.push(`${fence}markdown`)
    out.push(bundle.currentSourceText.trimEnd())
    out.push(fence)
    out.push('')
    out.push(`Current ${counterpartLanguage} (bring this along):`)
    out.push('')
    out.push(`${fence}markdown`)
    out.push(bundle.counterpartText.trimEnd())
    out.push(fence)
  }
  if (firstOccurrenceNotes.length > 0) {
    out.push('')
    out.push('## First-occurrence notes')
    out.push('')
    for (const note of firstOccurrenceNotes) out.push(`- ${note}`)
  }
}

/**
 * Render the complete briefing for one out-of-sync pair.
 *
 * @param input - Diff, mapped scope, terminology, and pair identity.
 * @returns Markdown briefing text.
 */
export function renderTranslationBrief(input: TranslationBriefInput): string {
  const sourceLanguage = input.direction === 'en-to-zh' ? 'English' : 'Chinese'
  const counterpartLanguage = input.direction === 'en-to-zh' ? 'Chinese' : 'English'
  const out: string[] = []
  out.push(`# Translation update briefing: ${input.sourcePath}`)
  out.push('')
  out.push(`The ${sourceLanguage} side changed; bring \`${input.counterpartPath}\` along with the smallest edit that covers the change.`)
  if (input.scope.kind === 'mechanical') {
    out.push('')
    out.push('## Mechanical update — no translation judgment involved')
    out.push('')
    out.push(`Every change since the last confirmed state is inside fenced code blocks, which are byte-identical across the pair. Run \`pnpm run gen-translation-brief --apply ${input.sourcePath}\` to splice the updated fences into the counterpart (the result is structure-validated before writing), then record per the Finish steps.`)
  }
  out.push('')
  out.push(`## ${sourceLanguage} diff (last-confirmed → current)`)
  out.push('')
  const diffFence = fenceFor(input.diff, '`')
  out.push(`${diffFence}diff`)
  out.push(input.diff.trimEnd())
  out.push(diffFence)
  switch (input.scope.kind) {
    case 'mechanical':
      break
    case 'units':
      out.push('')
      out.push(`## Changed units (last-confirmed ${sourceLanguage} → current ${sourceLanguage}, with the current ${counterpartLanguage})`)
      renderBundles(out, input, input.scope.bundles, input.scope.firstOccurrenceNotes)
      break
    case 'sections':
      out.push('')
      out.push('## Changed sections (fine-grained units do not align across the pair; whole heading sections shown)')
      renderBundles(out, input, input.scope.bundles, input.scope.firstOccurrenceNotes)
      break
    case 'document':
      out.push('')
      out.push('## Whole-document update required')
      out.push('')
      out.push(`${input.scope.reason} Open \`${input.counterpartPath}\` directly, locate the affected regions yourself, and reconcile under docs/i18n/translation-rules.md.`)
      break
    default:
      input.scope satisfies never
  }
  if (input.terminology.length > 0) {
    out.push('')
    out.push('## Binding terminology rows matching this change (docs/i18n/terminology.md)')
    out.push('')
    out.push('| English | 中文 | 首次出现 | 不要译作 | 备注 |')
    out.push('|---|---|---|---|---|')
    for (const row of input.terminology) out.push(row.line)
    out.push('')
    out.push('For any term you introduce that is not listed above, consult the full table before inventing a rendering.')
  }
  out.push('')
  out.push('## Rules digest (full rules: docs/i18n/translation-rules.md)')
  out.push('')
  out.push(...(input.direction === 'en-to-zh' ? ZH_TARGET_DIGEST : EN_TARGET_DIGEST))
  out.push('')
  out.push('## Finish')
  out.push('')
  out.push('1. Apply the smallest counterpart edit that covers the change, then verify the changed spans clause by clause against the source.')
  out.push(`2. \`pnpm run verify-translation-pairing --write ${input.sourcePath.replace(/\.zh\.md$/, '.md')}\``)
  out.push(`3. \`pnpm run verify-translation-pairing ${input.sourcePath.replace(/\.zh\.md$/, '.md')}\``)
  out.push('')
  return out.join('\n')
}
