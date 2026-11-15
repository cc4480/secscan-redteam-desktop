import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { parseJsDoc, pointer, rawJsDoc } from './jsdoc.ts'
import type { FileCtx, TypeDecl, TypeRef } from './gen-config-catalog-types.ts'

/** Throw one aggregate error for every violation the walk collected. */
export function report(violations: string[]): void {
  if (violations.length === 0) return
  throw new Error(
    `gen-config-catalog: ${violations.length} violation(s):\n`
    + violations.map(v => `  ${v}`).join('\n'),
  )
}

/** Parse a source file and index its import declarations. */
export function loadFile(abs: string, rel: string, cache: Map<string, FileCtx>): FileCtx {
  const cached = cache.get(abs)
  if (cached) return cached
  const text = readFileSync(abs, 'utf8')
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
  const imports: FileCtx['imports'] = new Map()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const specifier = stmt.moduleSpecifier.text
    const clause = stmt.importClause
    if (!clause) continue
    if (clause.name) imports.set(clause.name.text, { imported: 'default', specifier })
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        imports.set(el.name.text, {
          imported: (el.propertyName ?? el.name).text,
          specifier,
          typeOnly: clause.phaseModifier === ts.SyntaxKind.TypeKeyword || el.isTypeOnly,
        })
      }
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      imports.set(clause.namedBindings.name.text, { imported: '*', specifier })
    }
  }
  const ctx = { abs, rel, text, sf, imports }
  cache.set(abs, ctx)
  return ctx
}

/** Find a pasteable type declaration by name in a file, or null. */
export function findTypeDecl(ctx: FileCtx, name: string): TypeDecl | null {
  for (const stmt of ctx.sf.statements) {
    if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt))
      && stmt.name.text === name) return stmt
  }
  return null
}

/**
 * Resolve a type name from a file to its declaration (following package-local
 * relative imports transitively) or to the import that brings it in. Returns
 * `null` when the name is neither declared, imported, nor a known global.
 */
export function resolveTypeName(
  ctx: FileCtx,
  name: string,
  cache: Map<string, FileCtx>,
  violations: string[],
): { decl: TypeDecl; ctx: FileCtx } | { ref: TypeRef } | null {
  const local = findTypeDecl(ctx, name)
  if (local) return { decl: local, ctx }
  const imp = ctx.imports.get(name)
  if (!imp) return null
  if (imp.specifier.startsWith('.')) {
    if (!imp.specifier.endsWith('.ts')) {
      violations.push(`${ctx.rel}: relative import '${imp.specifier}' lacks the explicit .ts extension the repo convention requires.`)
      return null
    }
    if (imp.imported !== name) {
      violations.push(`${ctx.rel}: '${name}' aliases '${imp.imported}' across a package-local import; the catalog pastes declarations verbatim, so keep package-local config types unaliased.`)
      return null
    }
    const abs = resolve(dirname(ctx.abs), imp.specifier)
    const rel = ctx.rel.slice(0, ctx.rel.lastIndexOf('/') + 1) + imp.specifier.replace(/^\.\//, '')
    const target = loadFile(abs, rel, cache)
    return resolveTypeName(target, imp.imported, cache, violations)
  }
  return { ref: { alias: name, imported: imp.imported, specifier: imp.specifier } }
}

/** Collect every type NAME referenced in type positions under a node. */
export function collectTypeNames(node: ts.Node, out: Set<string>): void {
  const visit = (n: ts.Node): void => {
    if (ts.isTypeReferenceNode(n)) {
      let head: ts.EntityName = n.typeName
      while (ts.isQualifiedName(head)) head = head.left
      out.add(head.text)
    } else if (ts.isExpressionWithTypeArguments(n) && ts.isIdentifier(n.expression)) {
      out.add(n.expression.text) // heritage clause: `extends X`
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
}

/** The verbatim paste text of a declaration: leading JSDoc through the end. */
export function pasteText(ctx: FileCtx, decl: TypeDecl): string {
  const raw = rawJsDoc(ctx.text, decl)
  const start = raw ? ctx.text.indexOf(raw, decl.getFullStart()) : decl.getStart(ctx.sf)
  return ctx.text.slice(start, decl.end)
}

/** Enforce non-empty JSDoc prose on every property of a pasted declaration,
 * recursing into nested type literals (e.g. an array-of-objects field). */
export function checkMemberDocs(ctx: FileCtx, decl: TypeDecl, violations: string[]): void {
  const walkMembers = (members: ts.NodeArray<ts.TypeElement>, path: string): void => {
    for (const member of members) {
      if (!ts.isPropertySignature(member)) continue
      const name = member.name.getText(ctx.sf)
      const where = `config field '${path}.${name}' (${pointer(ctx.rel, ctx.sf, member)})`
      if (!parseJsDoc(rawJsDoc(ctx.text, member)).doc) violations.push(`${where} has no JSDoc prose.`)
      if (member.type) walkNested(member.type, `${path}.${name}`)
    }
  }
  const walkNested = (type: ts.Node, path: string): void => {
    if (ts.isTypeLiteralNode(type)) walkMembers(type.members, path)
    else ts.forEachChild(type, (n) => { walkNested(n, path) })
  }
  if (ts.isInterfaceDeclaration(decl)) walkMembers(decl.members, decl.name.text)
  else if (ts.isTypeAliasDeclaration(decl)) walkNested(decl.type, decl.name.text)
}
