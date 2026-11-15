/**
 * Document-wide first-occurrence tracking for the relevant terminology terms,
 * which decides which unchanged spans must join a briefing.
 */

import type { MarkdownSpan } from './translation-brief-spans.ts'
import { termOffsets, type TerminologyRow } from './translation-brief-terminology.ts'

function lineAtOffset(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
}

function spanIndexAtOffset(text: string, spans: MarkdownSpan[], offset: number | undefined): number | undefined {
  if (offset === undefined) return undefined
  const line = lineAtOffset(text, offset)
  return spans.find(span => line >= span.startLine && line <= span.endLine)?.index
}

/** First-occurrence guidance computed for a Chinese-target update. */
export interface FirstOccurrenceContext {
  /** Human-readable notes for the briefing. */
  notes: string[]
  /** Unchanged span indices that must join the briefing because a first occurrence moved into or out of them. */
  extraSpanIndices: number[]
}

/**
 * Track document-wide first occurrences of the relevant English terms. The
 * 首次出现 rendering attaches to a term's first occurrence, so when an edit
 * moves that occurrence across spans, both the old and new spans need
 * counterpart edits even when only one of them changed.
 *
 * @param confirmedSource - Last-confirmed English text.
 * @param currentSource - Current English text.
 * @param confirmedSpans - Spans of the last-confirmed English text.
 * @param currentSpans - Spans of the current English text, aligned with `confirmedSpans`.
 * @param rows - The relevant terminology rows.
 * @param changed - Span indices already in the briefing.
 * @returns Notes and extra span indices to include.
 */
export function firstOccurrenceContext(
  confirmedSource: string,
  currentSource: string,
  confirmedSpans: MarkdownSpan[],
  currentSpans: MarkdownSpan[],
  rows: TerminologyRow[],
  changed: Set<number>,
): FirstOccurrenceContext {
  const notes: string[] = []
  const extra = new Set<number>()
  for (const row of rows) {
    if (row.first === '') continue
    const oldIndex = spanIndexAtOffset(confirmedSource, confirmedSpans, termOffsets(confirmedSource, row.english, true)[0])
    const newIndex = spanIndexAtOffset(currentSource, currentSpans, termOffsets(currentSource, row.english, true)[0])
    if (oldIndex === newIndex) continue
    for (const index of [oldIndex, newIndex]) {
      if (index !== undefined && !changed.has(index)) extra.add(index)
    }
    notes.push(`${row.english}: the document-wide first occurrence moved from ${oldIndex === undefined ? 'absent' : `#${oldIndex}`} to ${newIndex === undefined ? 'absent' : `#${newIndex}`}; the ${row.first} form moves with it (later occurrences drop the annotation).`)
  }
  return { notes, extraSpanIndices: [...extra].sort((left, right) => left - right) }
}
