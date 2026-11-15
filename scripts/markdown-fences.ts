/** Parsed Markdown code-block extraction for documentation gates. */

import { parseMarkdown, visitMarkdown } from './markdown-parse.ts'

/** One code block from a parsed Markdown source. */
export interface MarkdownFence {
  /** 1-based source line of the opening fence. */
  line: number
  /** Info-string language (its first word), null on a bare or indented block. */
  lang: string | null
  /** Full info string (e.g. `ts ignore-check`), '' on a bare or indented block. */
  info: string
  /** Block body without the fence delimiters. */
  code: string
  /**
   * Whether a closing fence delimiter terminates the block — mdast silently
   * closes an unterminated fence at end of file. False on indented
   * (non-fenced) blocks, whose end line is code.
   */
  closed: boolean
}

/**
 * Extract every parsed code block with its info string, in document order.
 * @param source - Markdown source to scan.
 * @returns each block's opening line, language, info string, and body.
 */
export function markdownFences(source: string): MarkdownFence[] {
  const lines = source.split('\n')
  const fences: MarkdownFence[] = []
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type !== 'code' || node.position === undefined) return
    const lang = node.lang ?? null
    const meta = node.meta ?? ''
    const info = lang === null ? '' : meta === '' ? lang : `${lang} ${meta}`
    const endLine = lines[node.position.end.line - 1] ?? ''
    const closed = /^ {0,3}(`{3,}|~{3,})\s*$/.test(endLine)
    fences.push({ line: node.position.start.line, lang, info, code: node.value, closed })
  })
  return fences
}
