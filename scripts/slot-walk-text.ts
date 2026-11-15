/**
 * Source-text utilities every slot reading shares: a node's 1-based line, a
 * source slice with container indentation removed, one member's JSDoc, and the
 * parse mode a file's extension requires.
 */

import ts from 'typescript'

/**
 * TSX must parse as TSX; a `.ts` file with JSX-looking generics must not.
 * @param rel - repo-relative file path the extension is read from.
 * @returns the TypeScript parse mode for that extension.
 */
export function scriptKindOf(rel: string): ts.ScriptKind {
  return rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

/**
 * 1-based line of a node's first character.
 * @param sf - source file the node belongs to.
 * @param node - node whose start line is reported.
 * @returns the 1-based line number.
 */
export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

/**
 * Declaration text including leading JSDoc, with container indentation removed.
 * @param statement - declaration to slice out of the file.
 * @param sf - source file the statement belongs to.
 * @returns the declaration's source text, dedented.
 */
export function declarationText(statement: ts.Node, sf: ts.SourceFile): string {
  return dedent(sf.text.slice(statement.getStart(sf, true), statement.getEnd()))
}

/**
 * One member's JSDoc comment text, '' when the member has none.
 * @param member - declaration whose leading doc comment is read.
 * @param sf - source file the member belongs to.
 * @returns the dedented JSDoc block, or '' when undocumented.
 */
export function jsDocOf(member: ts.Node, sf: ts.SourceFile): string {
  // getStart(includeJsDoc) brackets exactly the doc comment: with it the range
  // opens at `/**`, without it at the member itself.
  const withDoc = member.getStart(sf, true)
  const withoutDoc = member.getStart(sf, false)
  if (withDoc >= withoutDoc) return ''
  return dedent(sf.text.slice(withDoc, withoutDoc).trimEnd())
}

/**
 * Strip the shared leading indentation of a multi-line source slice.
 * @param text - source slice to dedent.
 * @returns the slice with its shared leading indentation removed.
 */
function dedent(text: string): string {
  const lines = text.split('\n')
  const indents = lines.slice(1).filter(line => line.trim() !== '')
    .map(line => (/^\s*/.exec(line) as RegExpExecArray)[0].length)
  const shared = indents.length === 0 ? 0 : Math.min(...indents)
  return [lines[0] ?? '', ...lines.slice(1).map(line => line.slice(shared))].join('\n').trimEnd()
}

/**
 * Collapse a type text to one line so catalog rows stay one row.
 * @param text - type text to flatten.
 * @returns the text with whitespace runs collapsed and ends trimmed.
 */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * A property name's text, quotes removed.
 * @param name - property name node to read.
 * @returns the identifier or string-literal text.
 */
export function memberName(name: ts.PropertyName): string {
  return ts.isStringLiteral(name) || ts.isIdentifier(name) ? name.text : name.getText()
}
