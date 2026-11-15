/**
 * Scope dispatch for the exported-API JSDoc gate: the `export { … }` list and
 * default-export resolution of a lexical scope, and the per-declaration dispatch
 * that hands each exported form to its check and fails closed on unknown forms.
 */

import ts from 'typescript'
import { parseJsDoc, pointer, rawJsDoc } from './jsdoc.ts'
import { checkClass } from './verify-export-jsdoc-class.ts'
import {
  callableAnnotation,
  checkDescribed,
  checkFunctionLike,
  declarationName,
  isExported,
  unwrapExpression,
  type Walk,
} from './verify-export-jsdoc-walk.ts'

/** Plugin-protocol slot names exempt as top-level exports (const or function). */
const PROTOCOL_EXPORTS = new Set(['Config', 'inject', 'name', 'reusable', 'apply'])

/**
 * Check one exported declaration.
 * @param stmt - exported statement.
 * @param prefix - namespace qualifier.
 * @param overloadSigs - bodyless overload names.
 * @param byName - declarations keyed by name.
 * @param ambient - whether exports are implicit.
 * @param w - walk state.
 * @param only - selected declarators, or all.
 */
function checkDecl(
  stmt: ts.Statement,
  prefix: string,
  overloadSigs: Set<string>,
  byName: Map<string, ts.Statement[]>,
  ambient: boolean,
  w: Walk,
  only: ReadonlySet<string> | null = null,
): void {
  const at = (n: ts.Node): string => ` (${pointer(w.rel, w.sf, n)})`
  if (ts.isFunctionDeclaration(stmt)) {
    const name = stmt.name?.text ?? 'default'
    if (prefix === '' && PROTOCOL_EXPORTS.has(name)) return // cordis plugin-protocol slot
    if (stmt.body && overloadSigs.has(name)) return // overload implementation: the signatures carry the docs
    checkFunctionLike(`exported function '${prefix}${name}'${at(stmt)}`, rawJsDoc(w.text, stmt),
      stmt.parameters, stmt.type, false, w)
    return
  }
  if (ts.isClassDeclaration(stmt)) {
    checkClass(stmt, `${prefix}${stmt.name?.text ?? 'default'}`, w)
    return
  }
  if (ts.isInterfaceDeclaration(stmt)) {
    checkDescribed(`exported interface '${prefix}${stmt.name.text}'${at(stmt)}`, rawJsDoc(w.text, stmt), w)
    return
  }
  if (ts.isTypeAliasDeclaration(stmt)) {
    checkDescribed(`exported type '${prefix}${stmt.name.text}'${at(stmt)}`, rawJsDoc(w.text, stmt), w)
    return
  }
  if (ts.isEnumDeclaration(stmt)) {
    checkDescribed(`exported enum '${prefix}${stmt.name.text}'${at(stmt)}`, rawJsDoc(w.text, stmt), w)
    return
  }
  if (ts.isVariableStatement(stmt)) {
    const raw = rawJsDoc(w.text, stmt) // JSDoc sits on the statement, not the declarator
    for (const d of stmt.declarationList.declarations) {
      const name = ts.isIdentifier(d.name) ? d.name.text : d.name.getText(w.sf)
      if (only !== null && !only.has(name)) continue // sibling declarator the export list never named: not exported API
      if (prefix === '' && PROTOCOL_EXPORTS.has(name)) continue // cordis plugin-protocol slot
      const where = `exported const '${prefix}${name}'${at(d)}`
      const annotation = d.type !== undefined ? callableAnnotation(d.type) : null
      const init = d.initializer !== undefined ? unwrapExpression(d.initializer) : undefined
      if (annotation === 'refuse') {
        // A literal mixing call/construct signatures with other members (or
        // overloading them) has no single signature the walk can hold the
        // tags against — fail closed rather than silently narrow the check.
        w.violations.push(`${where}: its callable type literal is not gate-classifiable; extract a named type and document it there.`)
      } else if (annotation !== null) {
        // An INLINE callable annotation is the exported signature itself: its
        // parameters and result need docs right here. (A NAMED reference
        // type carries its docs at the type's own declaration instead.)
        checkFunctionLike(where, raw, annotation.parameters, annotation.type, false, w)
      } else if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        // A named declarator type annotation (`const f: Handler = …`) hands
        // the return contract to the named type; the arrow's own annotation is
        // still checked when it is the only signature the reader has.
        checkFunctionLike(where, raw, init.parameters, init.type, init.type === undefined && d.type !== undefined, w)
      } else {
        checkDescribed(where, raw, w)
      }
    }
    return
  }
  if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
    // A namespace merging with a documented same-name sibling (the
    // Config-namespace idiom) needs no second doc block of its own.
    const siblings = (byName.get(stmt.name.text) ?? []).filter(s => s !== stmt)
    const merged = siblings.some(s => parseJsDoc(rawJsDoc(w.text, s)).doc !== '')
    if (!merged) checkDescribed(`exported namespace '${prefix}${stmt.name.text}'${at(stmt)}`, rawJsDoc(w.text, stmt), w)
    let body = stmt.body
    let nsPrefix = `${prefix}${stmt.name.text}.`
    while (body !== undefined && ts.isModuleDeclaration(body)) { // dotted `namespace A.B`
      nsPrefix += `${body.name.getText(w.sf)}.`
      body = body.body
    }
    // In an ambient (`declare`) namespace body, members are implicitly
    // exported — no `export` modifier required — so the recursion must treat
    // every statement as exported API.
    const declared = ambient
      || ((ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined)?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false)
    if (body !== undefined && ts.isModuleBlock(body)) checkScope(body.statements, nsPrefix, w, declared)
    return
  }
  if (ts.isImportEqualsDeclaration(stmt)) {
    const where = `exported alias '${prefix}${stmt.name.text}'${at(stmt)}`
    // An alias is a distinct exported name whose target may be a non-exported namespace member
    // no walk ever visits, so it documents ITSELF — which matches the gate's strength only for
    // prose-only target kinds.
    const sym = w.checker.getSymbolAtLocation(stmt.name)
    const target = sym !== undefined && (sym.flags & ts.SymbolFlags.Alias) !== 0 ? w.checker.getAliasedSymbol(sym) : sym
    const RICH_TARGETS = ts.SymbolFlags.Function | ts.SymbolFlags.Class | ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule
    const rich = target === undefined
      || (target.flags & RICH_TARGETS) !== 0
      || w.checker.getTypeOfSymbol(target).getCallSignatures().length > 0
    if (rich) {
      w.violations.push(`${where} aliases a callable, class, or namespace target whose signature/member contract the alias cannot carry; export the declaration directly instead.`)
      return
    }
    checkDescribed(where, rawJsDoc(w.text, stmt), w)
    return
  }
  // Fail CLOSED: an exported statement kind this dispatch does not recognize
  // must never pass silently — the gate's whole promise is that unchecked
  // unchecked API cannot exist. New TypeScript export forms extend the gate here.
  w.violations.push(`exported statement${at(stmt)} uses an export form verify-export-jsdoc does not handle; extend the gate.`)
}

/**
 * Walk one lexical scope (file top level or a namespace body): check every
 * exported declaration, resolving `export { … }` lists (no module specifier)
 * to their local declarations.
 * @param statements - the scope's statements.
 * @param prefix - the namespace qualification for exported names ('' at top level).
 * @param w - the walk state violations append to.
 * @param ambient - whether this scope is ambient (`declare` namespace or a declaration file), where members export implicitly.
 */
export function checkScope(
  statements: readonly ts.Statement[],
  prefix: string,
  w: Walk,
  ambient: boolean,
  allowedNames?: ReadonlySet<string>,
): void {
  const byName = new Map<string, ts.Statement[]>()
  const overloadSigs = new Set<string>()
  const add = (name: string, stmt: ts.Statement): void => {
    byName.set(name, [...(byName.get(name) ?? []), stmt])
  }
  for (const stmt of statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      if (stmt.name) add(stmt.name.text, stmt)
      if (!stmt.body && stmt.name) overloadSigs.add(stmt.name.text)
    } else if (ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)
      || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      if (stmt.name) add(stmt.name.text, stmt)
    } else if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
      add(stmt.name.text, stmt)
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) add(d.name.text, stmt)
      }
    }
  }
  // Two-phase dispatch.
  const requested = new Map<ts.Statement, Set<string> | null>()
  const request = (stmt: ts.Statement, name: string | null): void => {
    const prior = requested.get(stmt)
    if (name === null || prior === null) {
      requested.set(stmt, null)
      return
    }
    requested.set(stmt, prior === undefined ? new Set([name]) : prior.add(name))
  }
  for (const stmt of statements) {
    if (ts.isModuleDeclaration(stmt)
      && (ts.isStringLiteral(stmt.name) || (stmt.flags & ts.NodeFlags.GlobalAugmentation) !== 0)) {
      continue // `declare module '…'` / `declare global` augmentation: not an export of this package
    }
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier) continue // re-export: the defining module is walked on its own
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text
          for (const decl of byName.get(local) ?? []) request(decl, local)
          // a name with no local declaration is an imported binding re-exported
          // without a specifier — its defining module is walked on its own
        }
      }
      continue
    }
    if (ts.isExportAssignment(stmt)) {
      if (stmt.isExportEquals) {
        // `export =` has no ESM consumer API in this repo and the walk
        // cannot classify its operand's type; refuse rather than fail open.
        w.violations.push(`export-equals assignment (${pointer(w.rel, w.sf, stmt)}) is not a gate-supported export form; use ESM named exports.`)
        continue
      }
      const where = `default export (${pointer(w.rel, w.sf, stmt)})`
      const expr = unwrapExpression(stmt.expression)
      if (ts.isIdentifier(expr)) {
        for (const decl of byName.get(expr.text) ?? []) request(decl, expr.text)
      } else if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        checkFunctionLike(where, rawJsDoc(w.text, stmt), expr.parameters, expr.type, false, w)
      } else {
        checkDescribed(where, rawJsDoc(w.text, stmt), w)
      }
      continue
    }
    if (isExported(stmt) || (ambient && !ts.isImportDeclaration(stmt))) {
      if (allowedNames === undefined) {
        request(stmt, null)
      } else if (ts.isVariableStatement(stmt)) {
        for (const declaration of stmt.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && allowedNames.has(declaration.name.text)) {
            request(stmt, declaration.name.text)
          }
        }
      } else {
        const name = declarationName(stmt) ?? 'default'
        if (allowedNames.has(name)) request(stmt, null)
      }
    }
  }
  for (const stmt of statements) {
    const only = requested.get(stmt)
    if (only !== undefined) checkDecl(stmt, prefix, overloadSigs, byName, ambient, w, only)
  }
}
