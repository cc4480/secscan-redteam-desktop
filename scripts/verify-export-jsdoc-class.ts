/**
 * Class-declaration checks for the exported-API JSDoc gate: heritage exemption
 * lookup, inferred void-return classification, and the per-member walk that
 * holds public methods, properties, and accessors to their documentation duty.
 */

import ts from 'typescript'
import { checkParams, checkReturns, parseTags, pointer, rawJsDoc } from './jsdoc.ts'
import { checkDescribed, checkFunctionLike, isNonPublic, isStatic, thisReceiver, type Walk } from './verify-export-jsdoc-walk.ts'

/** Plugin-protocol slot names exempt as statics on an exported class. */
const PROTOCOL_STATICS = new Set(['Config', 'inject', 'name', 'reusable'])

/**
 * Find inherited documentation for a class member without exempting a newly public API.
 * @param cls - the class whose heritage to search.
 * @param name - the member name to look up.
 * @param staticSide - whether to search the constructor side instead of the instance side.
 * @param checker - the program's type checker.
 * @returns inherited parameter and return coverage, or `null` when none applies.
 */
function heritageExemption(
  cls: ts.ClassDeclaration,
  name: string,
  staticSide: boolean,
  checker: ts.TypeChecker,
): { baseParams: Set<string> | null; baseVoidReturn: boolean | null } | null {
  const isProtected = (d: ts.Declaration): boolean =>
    (ts.canHaveModifiers(d) ? ts.getModifiers(d) : undefined)?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword) ?? false
  for (const clause of cls.heritageClauses ?? []) {
    for (const t of clause.types) {
      const type = staticSide ? checker.getTypeAtLocation(t.expression) : checker.getTypeAtLocation(t)
      const prop = type.getProperty(name)
      if (prop === undefined) continue
      const decls = prop.declarations ?? []
      if (decls.length > 0 && decls.every(isProtected)) continue // public override of a protected base: new API
      let baseParams: Set<string> | null = null
      let baseVoidReturn: boolean | null = null
      for (const d of decls) {
        let params: readonly ts.ParameterDeclaration[] | undefined
        let returnType: ts.TypeNode | undefined
        if (ts.isMethodDeclaration(d) || ts.isMethodSignature(d)) {
          params = d.parameters
          returnType = d.type
        } else if ((ts.isPropertySignature(d) || ts.isPropertyDeclaration(d)) && d.type !== undefined && ts.isFunctionTypeNode(d.type)) {
          params = d.type.parameters
          returnType = d.type.type
        } else continue
        baseParams ??= new Set()
        // Leading underscores are the deliberately-unused marker (lint
        // argsIgnorePattern), not a rename: `_cwd` overriding `cwd` is the
        // same parameter, so compare underscore-stripped on both sides.
        for (const p of params) if (ts.isIdentifier(p.name)) baseParams.add(p.name.text.replace(/^_+/, ''))
        if (returnType !== undefined) {
          const voidish = /^(void|Promise<void>)$/.test(returnType.getText(d.getSourceFile()).replace(/\s+/g, ' '))
          baseVoidReturn = (baseVoidReturn ?? true) && voidish
        }
      }
      return { baseParams, baseVoidReturn }
    }
  }
  return null
}

/**
 * True when a method's INFERRED return type is void-like (void, undefined,
 * never, or a promise of one) — the one return the walk asks the checker to
 * classify: an unannotated override above a void heritage member, where
 * demanding an annotation just to prove faithfulness would be boilerplate.
 * @param m - a method declaration with no return type annotation.
 * @param checker - the program's type checker.
 * @returns true when the inferred result carries nothing to document.
 */
function inferredReturnIsVoidish(m: ts.MethodDeclaration, checker: ts.TypeChecker): boolean {
  const sig = checker.getSignatureFromDeclaration(m)
  if (sig === undefined) return true // no callable signature: nothing classifiable to document
  const returned = checker.getReturnTypeOfSignature(sig)
  const awaited = checker.getAwaitedType(returned) ?? returned
  return (awaited.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never)) !== 0
}

/**
 * Check one exported class: class-level prose, the function contract on every
 * public method (overload implementations exempt), and description prose on
 * public properties and accessors (a get/set pair is covered by the getter's
 * doc). Heritage-declared members are exempt per heritageExemption (an
 * override's extra parameters keep their @param duty); plugin-protocol
 * statics are exempt; constructors are not checked (framework-constructed
 * plugins, and the class doc owns the story).
 * @param cls - the exported class declaration.
 * @param name - the class's exported name (namespace-qualified).
 * @param w - the walk state violations append to.
 */
export function checkClass(cls: ts.ClassDeclaration, name: string, w: Walk): void {
  checkDescribed(`exported class '${name}' (${pointer(w.rel, w.sf, cls)})`, rawJsDoc(w.text, cls), w)
  const overloadSigs = new Set<string>()
  const documentedGetters = new Set<string>()
  for (const m of cls.members) {
    if ('name' in m && ts.isComputedPropertyName(m.name)) continue
    if (ts.isMethodDeclaration(m) && !m.body) overloadSigs.add(m.name.getText(w.sf))
    if (ts.isGetAccessorDeclaration(m)) documentedGetters.add(m.name.getText(w.sf))
  }
  for (const m of cls.members) {
    if (isNonPublic(m) || ts.isConstructorDeclaration(m)) continue
    if (!('name' in m) || ts.isComputedPropertyName(m.name)) continue // computed/symbol members
    const mname = m.name.getText(w.sf)
    if (isStatic(m) && PROTOCOL_STATICS.has(mname)) continue // cordis plugin-protocol slot
    const exemption = heritageExemption(cls, mname, isStatic(m), w.checker)
    if (ts.isMethodDeclaration(m)) {
      if (m.body && overloadSigs.has(mname)) continue // overload implementation: the signatures carry the docs
      const where = `exported class method '${name}.${mname}' (${pointer(w.rel, w.sf, m)})`
      if (exemption !== null) {
        const raw = rawJsDoc(w.text, m)
        // The heritage declaration owns the prose; parameters the base never
        // names — including binding patterns, which no base declaration can
        // name — are new API and keep their @param duty.
        const base = exemption.baseParams
        const inBase = (p: ts.ParameterDeclaration): boolean =>
          base !== null && ts.isIdentifier(p.name) && base.has(p.name.text.replace(/^_+/, ''))
        if (base !== null && m.parameters.some(p => !thisReceiver(p) && !inBase(p))) {
          checkParams(where, 'exported', m.parameters, parseTags(raw).params, w.sf,
            p => thisReceiver(p) || inBase(p), w.violations)
        }
        // A void base return carried no @returns duty, so an override growing a concrete result
        // documents it itself.
        if (exemption.baseVoidReturn === true) {
          if (m.type !== undefined) {
            checkReturns(where, m.type, parseTags(raw).returns, w.sf, w.violations)
          } else if (!inferredReturnIsVoidish(m, w.checker)) {
            w.violations.push(`${where} returns a non-void result its heritage declaration does not document; annotate the return type and add @returns.`)
          }
        }
        continue
      }
      checkFunctionLike(where, rawJsDoc(w.text, m), m.parameters, m.type, false, w)
    } else if (exemption !== null) {
      continue // the heritage declaration owns the doc (properties/accessors carry no own parameters)
    } else if (ts.isGetAccessorDeclaration(m) || ts.isPropertyDeclaration(m)) {
      const kind = ts.isPropertyDeclaration(m) ? 'property' : 'accessor'
      checkDescribed(`exported class ${kind} '${name}.${mname}' (${pointer(w.rel, w.sf, m)})`, rawJsDoc(w.text, m), w)
    } else if (ts.isSetAccessorDeclaration(m) && !documentedGetters.has(mname)) {
      checkDescribed(`exported class accessor '${name}.${mname}' (${pointer(w.rel, w.sf, m)})`, rawJsDoc(w.text, m), w)
    }
    // index signatures / static blocks: no named API
  }
}
