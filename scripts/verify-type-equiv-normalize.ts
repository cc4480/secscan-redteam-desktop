/** Comment- and whitespace-independent normalization used to compare declarations. */

import ts from 'typescript'

/** Normalize declaration structure independently of comments and whitespace. */
export function normalizeStructure(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract normalized JSDoc comments in source order. Type declarations in this
 * repository do not contain comment delimiters inside string literals.
 */
export function normalizeJSDoc(code: string): string[] {
  return [...code.matchAll(/\/\*\*[\s\S]*?\*\//g)]
    .map(match => match[0].replace(/\s+/g, ' ').trim())
}

/** Strip source-only export modifiers. */
export function stripExport(code: string): string {
  return code.replace(/^export\s+(default\s+)?/, '')
}

/** Parse the declared symbol name from a source-equivalence block body. */
export function blockSymbol(code: string): string | null {
  const sf = ts.createSourceFile('type-equiv.ts', code, ts.ScriptTarget.Latest, /* setParentNodes */ false, ts.ScriptKind.TS)
  for (const stmt of sf.statements) {
    const named =
      ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
      || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)
    if (named && stmt.name) return stmt.name.text
  }
  return null
}
