/**
 * Declaration paste for the Cordis core API reference: whole interface, type,
 * class, enum, and module declarations rendered with their method bodies
 * removed, so a page shows signatures and type members instead of the
 * implementation.
 */

import ts from 'typescript'
import { parseJsDoc, pointer } from './jsdoc.ts'
import { load, sourceJsDoc, type RenderContext } from './cordis-core-api-source.ts'

function stripBodies(node: ts.Node, sf: ts.SourceFile): string {
  const cuts: { start: number; end: number }[] = []
  const visit = (entry: ts.Node): void => {
    const functionLike = ts.isMethodDeclaration(entry)
      || ts.isConstructorDeclaration(entry)
      || ts.isFunctionDeclaration(entry)
      || ts.isGetAccessorDeclaration(entry)
      || ts.isSetAccessorDeclaration(entry)
    if (functionLike && entry.body !== undefined) {
      const signatureEnd = (entry.type ?? entry.parameters.at(-1) ?? entry).getEnd()
      cuts.push({ start: signatureEnd, end: entry.body.getEnd() })
      return
    }
    entry.forEachChild(visit)
  }
  visit(node)
  const base = node.getStart(sf)
  let output = node.getText(sf)
  for (const cut of cuts.sort((left, right) => right.start - left.start)) {
    const head = output.slice(0, cut.start - base)
    const between = output.slice(cut.start - base, cut.end - base)
    const bodyBrace = between.indexOf('{')
    output = head + between.slice(0, bodyBrace).trimEnd() + output.slice(cut.end - base)
  }
  return output
}

/**
 * Paste a named declaration from a source file with its implementation removed,
 * keeping the declaration's own JSDoc attached above the pasted code.
 * @param ctx - render state holding the scan cache.
 * @param rel - scan-root-relative path of the declaring source file.
 * @param symbol - the declaration name to paste; every matching declaration is included.
 * @returns the declaration's JSDoc prose, the pasted code, and its source pointer.
 */
export function declarationPaste(ctx: RenderContext, rel: string, symbol: string): { doc: string; code: string; source: string } {
  const { sf, text } = load(ctx, rel)
  const matches = sf.statements.filter((statement) => {
    const named = ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    return named && statement.name?.getText(sf) === symbol
  })
  const first = matches[0]
  if (first === undefined) throw new Error(`cordis-core-api: declaration ${symbol} not found in ${rel}.`)
  const doc = parseJsDoc(sourceJsDoc(text, sf, first)).doc
  const code = matches.map((statement) => {
    const jsDoc = sourceJsDoc(text, sf, statement)
    const declaration = stripBodies(statement, sf).replace(/^export\s+(default\s+)?/, '')
    return jsDoc === '' ? declaration : `${jsDoc}\n${declaration}`
  }).join('\n\n')
  return { doc, code, source: pointer(rel, sf, first) }
}
