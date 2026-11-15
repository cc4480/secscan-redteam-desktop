/**
 * Markdown span listing shared by the unit- and section-granularity
 * briefings, plus the code-fence-only splice that needs no translation
 * judgment.
 */

import type { Nodes } from 'mdast'
import { parseTranslationMarkdown } from './translation-pairing.ts'

/** One block-level span of a Markdown document, in document order. */
export interface MarkdownSpan {
  /** Position in the span list; briefing ids derive from it. */
  index: number
  /**
   * Structural kind compared for alignment, language-neutral: container path
   * plus node type for units (`root.3:tableRow`), depth for sections (`section:2`).
   */
  kind: string
  /** Reader-facing label: heading text for sections, node type for units. */
  label: string
  /** 1-based first source line. */
  startLine: number
  /** 1-based last source line. */
  endLine: number
  /** The span's text, trailing newline normalized to exactly one. */
  text: string
}

function linesOf(markdown: string): string[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function sliceLines(lines: string[], startLine: number, endLine: number): string {
  return `${lines.slice(startLine - 1, endLine).join('\n')}\n`
}

/**
 * List a document's translation units: the outermost block nodes a minimal
 * update can replace independently. Headings, paragraphs, code fences, table
 * rows, list items, block quotes, HTML blocks, thematic breaks, and link
 * definitions are units; the container path is part of the kind so kind
 * sequences only align when container membership also aligns.
 *
 * @param markdown - Document text.
 * @returns Units in document order.
 */
export function markdownUnits(markdown: string): MarkdownSpan[] {
  const positions: Array<{ kind: string; label: string; startLine: number; endLine: number }> = []
  const visit = (node: Nodes, path: string): void => {
    let kind: string | undefined
    switch (node.type) {
      case 'heading':
        kind = `${path}:heading:${node.depth}`
        break
      case 'paragraph':
      case 'code':
      case 'tableRow':
      case 'listItem':
      case 'blockquote':
      case 'html':
      case 'thematicBreak':
      case 'definition':
        kind = `${path}:${node.type}`
        break
      default:
        break
    }
    if (kind !== undefined && node.position !== undefined) {
      positions.push({ kind, label: node.type, startLine: node.position.start.line, endLine: node.position.end.line })
      return
    }
    if ('children' in node) for (const [index, child] of node.children.entries()) visit(child, `${path}.${index}`)
  }
  visit(parseTranslationMarkdown(markdown), 'root')
  positions.sort((left, right) => left.startLine - right.startLine)
  const lines = linesOf(markdown)
  return positions.map((position, index) => ({
    index,
    ...position,
    text: sliceLines(lines, position.startLine, position.endLine),
  }))
}

/**
 * List a document's heading-delimited sections, including a leading
 * `preamble` span when content precedes the first heading.
 *
 * @param markdown - Document text.
 * @returns Sections in document order.
 */
export function sectionSpans(markdown: string): MarkdownSpan[] {
  const headings: Array<{ depth: number; line: number; label: string }> = []
  const visit = (node: Nodes): void => {
    if (node.type === 'heading' && node.position !== undefined) {
      let label = ''
      const collect = (child: Nodes): void => {
        if ('value' in child && typeof child.value === 'string') label += child.value
        if ('children' in child) for (const grandchild of child.children) collect(grandchild)
      }
      for (const child of node.children) collect(child)
      headings.push({ depth: node.depth, line: node.position.start.line, label })
    }
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(parseTranslationMarkdown(markdown))
  headings.sort((left, right) => left.line - right.line)
  const lines = linesOf(markdown)
  const spans: MarkdownSpan[] = []
  const firstHeadingLine = headings[0]?.line ?? lines.length + 1
  if (firstHeadingLine > 1) {
    spans.push({ index: 0, kind: 'preamble', label: '(preamble before the first heading)', startLine: 1, endLine: firstHeadingLine - 1, text: sliceLines(lines, 1, firstHeadingLine - 1) })
  }
  for (const [order, heading] of headings.entries()) {
    const endLine = (headings[order + 1]?.line ?? lines.length + 1) - 1
    spans.push({
      index: spans.length,
      // Depth only: heading TEXT is translated across a pair, so it cannot
      // participate in cross-language alignment.
      kind: `section:${heading.depth}`,
      label: heading.label === '' ? '(untitled section)' : heading.label,
      startLine: heading.line,
      endLine,
      text: sliceLines(lines, heading.line, endLine),
    })
  }
  return spans
}

/**
 * Whether two span lists map one to one: same non-zero length and the same
 * kind at every position.
 *
 * @param left - One document's spans.
 * @param right - The other document's spans.
 * @returns True when index-wise mapping is sound.
 */
export function spansAligned(left: MarkdownSpan[], right: MarkdownSpan[]): boolean {
  return left.length > 0
    && left.length === right.length
    && left.every((span, index) => span.kind === right[index]?.kind)
}

/**
 * Indices whose text differs between two aligned span lists.
 *
 * @param before - Spans of the earlier state.
 * @param after - Spans of the later state, aligned with `before`.
 * @returns Ascending changed indices.
 */
export function changedSpanIndices(before: MarkdownSpan[], after: MarkdownSpan[]): number[] {
  return before.filter((span, index) => span.text !== after[index]?.text).map(span => span.index)
}

function codeSpansOf(markdown: string): MarkdownSpan[] {
  return markdownUnits(markdown).filter(span => span.kind.endsWith(':code'))
    .map((span, index) => ({ ...span, index }))
}

function replaceSpanTexts(markdown: string, spans: MarkdownSpan[], replacements: Map<number, string>): string {
  const lines = linesOf(markdown)
  for (const [index, replacement] of [...replacements.entries()].sort((left, right) => right[0] - left[0])) {
    const span = spans[index]
    if (span === undefined) throw new Error(`translation brief: unknown replacement span ${index}`)
    lines.splice(span.startLine - 1, span.endLine - span.startLine + 1, ...linesOf(replacement))
  }
  return `${lines.join('\n')}\n`
}

function maskCodeSpans(markdown: string, spans: MarkdownSpan[]): string {
  return replaceSpanTexts(markdown, spans, new Map(spans.map(span => [span.index, `DSH_TRANSLATION_CODE_${span.index}\n`])))
}

/**
 * Compute the counterpart update for a change confined to fenced code
 * blocks. Fences are byte-identical across a pair, so when the source's
 * prose is untouched and the counterpart's fences match the last-confirmed
 * source, splicing the edited fences into the counterpart is the complete
 * update — no translation judgment is involved.
 *
 * @param confirmedSource - The changed side's last-confirmed text.
 * @param currentSource - The changed side's current text.
 * @param counterpart - The other side's current text.
 * @returns The updated counterpart, or undefined when the change is not code-only.
 */
export function computeMechanicalUpdate(confirmedSource: string, currentSource: string, counterpart: string): string | undefined {
  const confirmed = codeSpansOf(confirmedSource)
  const current = codeSpansOf(currentSource)
  const target = codeSpansOf(counterpart)
  if (confirmed.length === 0 || confirmed.length !== current.length || confirmed.length !== target.length) return undefined
  if (maskCodeSpans(confirmedSource, confirmed) !== maskCodeSpans(currentSource, current)) return undefined
  if (confirmed.some((span, index) => span.text !== target[index]?.text)) return undefined
  const changed = current.filter((span, index) => span.text !== confirmed[index]?.text)
  if (changed.length === 0) return undefined
  return replaceSpanTexts(counterpart, target, new Map(changed.map(span => [span.index, span.text])))
}
