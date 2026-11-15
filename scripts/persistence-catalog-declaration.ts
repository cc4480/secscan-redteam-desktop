/** Source text rendering for catalogued payload types and declarations. */

import ts from 'typescript'
import { rawJsDoc } from './jsdoc.ts'

const printer = ts.createPrinter({ removeComments: true })

/**
 * Render a member type on one line through the TypeScript printer, which adds
 * semicolon separators. Drop its trailing semicolon before `}` to match the
 * repository's inline-literal style.
 * @param type - the member's payload type annotation.
 * @param sf - the source file the type belongs to.
 * @returns the payload rendered on one line.
 */
export function payloadText(type: ts.TypeNode, sf: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, type, sf)
    .replace(/\s+/g, ' ')
    .replace(/;\s*\}/g, ' }')
    .trim()
}

/**
 * Copy a declaration from its leading JSDoc through its closing token while
 * removing only the indentation imposed by its containing interface/module.
 * @param text - the complete source text the node was parsed from.
 * @param sf - the source file the node belongs to.
 * @param node - the declaration to copy.
 * @returns the dedented declaration text, trailing whitespace trimmed.
 */
export function declarationText(text: string, sf: ts.SourceFile, node: ts.Node): string {
  const raw = rawJsDoc(text, node)
  const nodeStart = node.getStart(sf)
  const start = raw ? text.lastIndexOf(raw, nodeStart) : nodeStart
  const { line } = sf.getLineAndCharacterOfPosition(start)
  const lineStart = sf.getPositionOfLineAndCharacter(line, 0)
  const indent = text.slice(lineStart, start)
  return text.slice(lineStart, node.end)
    .split('\n')
    .map(lineText => lineText.startsWith(indent) ? lineText.slice(indent.length) : lineText)
    .join('\n')
    .trimEnd()
}
