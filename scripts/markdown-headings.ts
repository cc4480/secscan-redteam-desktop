/** Parsed Markdown heading extraction with rendered text for documentation gates. */

import type { Nodes } from 'mdast'
import { parseMarkdown, visitMarkdown } from './markdown-parse.ts'
import type { MarkdownProseLine } from './markdown-prose.ts'

/** One parsed Markdown heading, retaining its authored first line and rendered text. */
export interface MarkdownHeadingLine extends MarkdownProseLine {
  /** Parsed ATX or Setext heading depth. */
  depth: 1 | 2 | 3 | 4 | 5 | 6
  /** Rendered heading text, excluding raw HTML such as comments. */
  text: string
}

/** Text a reader sees from one Markdown node; raw HTML itself contributes none. */
function renderedText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if (node.type === 'break') return ' '
  if ('children' in node) return node.children.map(child => renderedText(child)).join('')
  return ''
}

/** Return every parsed Markdown heading with its rendered text and source line. */
export function markdownHeadingLines(source: string): MarkdownHeadingLine[] {
  const rawLines = source.split('\n')
  const headings: MarkdownHeadingLine[] = []
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type !== 'heading' || node.position === undefined) return
    headings.push({
      depth: node.depth,
      index: node.position.start.line,
      raw: rawLines[node.position.start.line - 1] ?? '',
      text: renderedText(node),
    })
  })
  return headings
}
