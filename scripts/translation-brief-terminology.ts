/**
 * Terminology-table parsing, term occurrence matching, and the selection of
 * the binding rows a changed text touches.
 */

/** One parsed terminology-table data row. */
export interface TerminologyRow {
  english: string
  chinese: string
  /** The 首次出现 cell (first-occurrence rendering), possibly empty. */
  first: string
  /** The verbatim table row. */
  line: string
}

/** Strip Markdown emphasis and code markers from a terminology cell. */
function plainTerm(cell: string): string {
  return cell.replaceAll('`', '').replaceAll('**', '').trim()
}

/**
 * Parse the data rows of the terminology table.
 *
 * @param terminology - Full `docs/i18n/terminology.md` contents.
 * @returns Rows in table order.
 */
export function parseTerminologyRows(terminology: string): TerminologyRow[] {
  const rows: TerminologyRow[] = []
  for (const line of terminology.split('\n')) {
    if (!line.startsWith('|')) continue
    if (/^\|[\s:|-]+\|$/.test(line)) continue
    const cells = line.split('|').map(cell => cell.trim())
    const english = plainTerm(cells[1] ?? '')
    if (english === '' || english === 'English') continue
    rows.push({ english, chinese: plainTerm(cells[2] ?? ''), first: plainTerm(cells[3] ?? ''), line })
  }
  return rows
}

/**
 * Character offsets of a term's occurrences. English word-like terms match
 * on word boundaries and accept plural inflections (`agents`, `registries`);
 * other terms match as case-insensitive substrings.
 *
 * @param text - Text to search.
 * @param term - The term to find.
 * @param englishInflections - Whether to accept English plural forms.
 * @returns Ascending match offsets.
 */
export function termOffsets(text: string, term: string, englishInflections = false): number[] {
  if (term === '') return []
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wordLike = /^[A-Za-z0-9][A-Za-z0-9 ._-]*[A-Za-z0-9]$/.test(term)
  const inflected = englishInflections && wordLike
    ? /[^aeiou]y$/i.test(term)
      ? `${escape(term.slice(0, -1))}(?:y|ies)`
      : `${escape(term)}(?:s|es)?`
    : escape(term)
  const expression = new RegExp(wordLike ? `(?<![A-Za-z0-9_])${inflected}(?![A-Za-z0-9_])` : inflected, 'gi')
  return [...text.matchAll(expression)].map(match => match.index)
}

/** The two update directions a pair supports. */
export type BriefDirection = 'en-to-zh' | 'zh-to-en'

/** Whether a row's source-language term occurs in the given text. */
function rowOccurs(row: TerminologyRow, direction: BriefDirection, text: string): boolean {
  const terms = direction === 'en-to-zh' ? [row.english] : [row.first, row.chinese].filter(term => /[一-鿿]/.test(term))
  return terms.some(term => termOffsets(text, term, direction === 'en-to-zh').length > 0)
}

/**
 * Select the terminology rows whose source-language term occurs in the
 * changed text (old and new states combined).
 *
 * @param terminology - Full `docs/i18n/terminology.md` contents.
 * @param direction - Update direction; decides which columns to match.
 * @param changedText - Concatenated old and new text of the changed spans.
 * @returns Matched rows in table order.
 */
export function relevantTerminologyRows(terminology: string, direction: BriefDirection, changedText: string): TerminologyRow[] {
  return parseTerminologyRows(terminology).filter(row => rowOccurs(row, direction, changedText))
}
