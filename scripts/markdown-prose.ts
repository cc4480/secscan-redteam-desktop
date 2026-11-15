/** Authored Markdown prose-line extraction, excluding fences and rendered-away comments. */

import { parseMarkdown, visitMarkdown } from './markdown-parse.ts'

/** One authored Markdown line outside fenced code and rendered-away HTML comments. */
export interface MarkdownProseLine {
  /** 1-based source line number. */
  index: number
  /** Source text without normalization. */
  raw: string
}

type ColumnRange = readonly [start: number, end: number]
type OffsetRange = readonly [start: number, end: number]

/** Source-column ranges occupied by parsed HTML comments, keyed by source line. */
function htmlCommentRanges(source: string, rawLines: readonly string[]): Map<number, ColumnRange[]> {
  const comments: OffsetRange[] = []
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type !== 'html' || node.position?.start.offset === undefined) return
    let cursor = 0
    while (true) {
      const start = node.value.indexOf('<!--', cursor)
      if (start < 0) break
      const close = node.value.indexOf('-->', start + '<!--'.length)
      const end = close < 0 ? node.value.length : close + '-->'.length
      comments.push([node.position.start.offset + start, node.position.start.offset + end])
      cursor = end
    }
  })

  const ranges = new Map<number, ColumnRange[]>()
  let lineOffset = 0
  rawLines.forEach((raw, index) => {
    const lineEnd = lineOffset + raw.length
    for (const [start, end] of comments) {
      const from = Math.max(start, lineOffset)
      const to = Math.min(end, lineEnd)
      const coversEmptyLine = raw.length === 0 && start <= lineOffset && end > lineOffset
      if (from < to || coversEmptyLine) {
        const lineRanges = ranges.get(index + 1) ?? []
        lineRanges.push([from - lineOffset, to - lineOffset])
        ranges.set(index + 1, lineRanges)
      }
    }
    lineOffset = lineEnd + 1
  })
  return ranges
}

/** Whether a source line retains non-whitespace text after HTML comments disappear. */
function hasRenderedTextOutsideComments(raw: string, ranges: readonly ColumnRange[] | undefined): boolean {
  if (ranges === undefined) return true
  let cursor = 0
  let visible = ''
  for (const [start, end] of [...ranges].sort((left, right) => left[0] - right[0])) {
    visible += raw.slice(cursor, start)
    cursor = Math.max(cursor, end)
  }
  visible += raw.slice(cursor)
  return visible.trim().length > 0
}

/**
 * Return source lines outside code blocks and HTML comments.
 * @param source - Markdown source whose prose should be retained verbatim.
 * @returns unfenced lines with their original 1-based locations.
 */
export function markdownProseLines(source: string): MarkdownProseLine[] {
  const rawLines = source.split('\n')
  const comments = htmlCommentRanges(source, rawLines)
  const fenced = new Set<number>()
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type !== 'code' || node.position === undefined) return
    for (let line = node.position.start.line; line <= node.position.end.line; line += 1) fenced.add(line)
  })
  const kept: MarkdownProseLine[] = []
  rawLines.forEach((raw, i) => {
    if (fenced.has(i + 1)) return
    if (hasRenderedTextOutsideComments(raw, comments.get(i + 1))) {
      kept.push({ index: i + 1, raw })
    }
  })
  return kept
}
