/** Source-side declaration lookup: named declarations, interfaces, and augmentations. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { repoRoot } from './verify-type-equiv-model.ts'
import { stripExport } from './verify-type-equiv-normalize.ts'

/**
 * The declaration text of `symbol` in `sourceRel`, with `export` stripped, or
 * null when the symbol is not declared there. Uses the TS parser so it spans
 * interfaces, type aliases (including mapped/generic ones), classes, and enums
 * uniformly while including declaration and member JSDoc.
 */
export function sourceDeclaration(sourceRel: string, symbol: string): string | null {
  const abs = resolve(repoRoot, sourceRel)
  const text = readFileSync(abs, 'utf8')
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, /* setParentNodes */ true)
  for (const stmt of sf.statements) {
    const named =
      ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
      || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)
    if (named && stmt.name?.text === symbol) {
      const declarationStart = stmt.getStart(sf)
      const jsDoc = ts.getJSDocCommentsAndTags(stmt)
        .filter(ts.isJSDoc)
        .map(doc => text.slice(doc.pos, doc.end))
        .join('\n')
      const declaration = stripExport(text.slice(declarationStart, stmt.getEnd()))
      return jsDoc === '' ? declaration : `${jsDoc}\n${declaration}`
    }
  }
  return null
}

/** One interface declaration together with the source text that declared it. */
export interface InterfacePart {
  text: string
  sourceFile: ts.SourceFile
  declaration: ts.InterfaceDeclaration
}

/** Find one top-level interface declaration in a source file. */
export function sourceInterface(sourceRel: string, symbol: string): InterfacePart | null {
  const abs = resolve(repoRoot, sourceRel)
  const text = readFileSync(abs, 'utf8')
  const sourceFile = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, /* setParentNodes */ true)
  const declaration = sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === symbol,
  )
  return declaration === undefined ? null : { text, sourceFile, declaration }
}

/** Find one interface declaration inside an explicit string-literal module augmentation. */
export function augmentedInterface(sourceRel: string, moduleName: string, symbol: string): InterfacePart | null {
  const abs = resolve(repoRoot, sourceRel)
  const text = readFileSync(abs, 'utf8')
  const sourceFile = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, /* setParentNodes */ true)
  for (const statement of sourceFile.statements) {
    if (!ts.isModuleDeclaration(statement) || !ts.isStringLiteral(statement.name)
      || statement.name.text !== moduleName || !statement.body || !ts.isModuleBlock(statement.body)) continue
    const declaration = statement.body.statements.find((member): member is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(member) && member.name.text === symbol,
    )
    if (declaration !== undefined) return { text, sourceFile, declaration }
  }
  return null
}

/** Leading source JSDoc attached to one declaration or member. */
export function sourceJSDoc(text: string, node: ts.Node): string {
  return ts.getJSDocCommentsAndTags(node)
    .filter(ts.isJSDoc)
    .map(doc => text.slice(doc.pos, doc.end))
    .join('\n')
}
