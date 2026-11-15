/**
 * Declaration classification for the exported-API JSDoc gate: the per-file walk
 * state, the modifier and wrapper predicates, inline callable classification,
 * and the description/`@param`/`@returns` checks every walker calls.
 */

import ts from 'typescript'
import { checkParams, checkReturns, parseJsDoc, parseTags } from './jsdoc.ts'

/** Per-file walk state threaded through the scope recursion. */
export interface Walk {
  rel: string
  sf: ts.SourceFile
  text: string
  checker: ts.TypeChecker
  violations: string[]
}

/**
 * True when a statement carries an `export` modifier.
 * @param stmt - the statement to classify.
 * @returns true for an explicitly exported statement.
 */
export function isExported(stmt: ts.Statement): boolean {
  return ts.canHaveModifiers(stmt) && (ts.getModifiers(stmt)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
}

/**
 * True when a class member is private, protected, or `#`-named.
 * @param member - the class element to classify.
 * @returns true when the member carries no public API.
 */
export function isNonPublic(member: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined
  return (mods?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword) ?? false)
    || ('name' in member && ts.isPrivateIdentifier(member.name))
}

/**
 * True when a class member carries a `static` modifier.
 * @param member - the class element to classify.
 * @returns true for a static member.
 */
export function isStatic(member: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined
  return mods?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false
}

/**
 * True when a parameter is a TypeScript `this` parameter.
 * @param p - the parameter to classify.
 * @returns true for the leading `this` receiver.
 */
export function thisReceiver(p: ts.ParameterDeclaration): boolean {
  return ts.isIdentifier(p.name) && p.name.text === 'this'
}

/**
 * Peel wrapper expressions that define no API of their own — parentheses,
 * `as` / `satisfies` / angle-bracket casts, non-null assertions — so a
 * wrapped function expression is still classified as function-like.
 * @param e - the expression to unwrap.
 * @returns the innermost non-wrapper expression.
 */
export function unwrapExpression(e: ts.Expression): ts.Expression {
  let inner = e
  while (
    ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)
    || ts.isNonNullExpression(inner) || ts.isTypeAssertionExpression(inner)
  ) inner = inner.expression
  return inner
}

/**
 * Classify inline callable annotations. Mixed callable literals fail closed;
 * other annotations are ordinary value types.
 * @param type - the declarator's type annotation.
 * @returns the signature to check, 'refuse' for an unclassifiable callable literal, or null for a non-callable type.
 */
export function callableAnnotation(type: ts.TypeNode): ts.SignatureDeclarationBase | 'refuse' | null {
  if (ts.isFunctionTypeNode(type)) return type
  if (!ts.isTypeLiteralNode(type)) return null
  const signatures = type.members.filter(m => ts.isCallSignatureDeclaration(m) || ts.isConstructSignatureDeclaration(m))
  if (signatures.length === 0) return null
  if (signatures.length === 1 && type.members.length === 1 && signatures[0] !== undefined && ts.isCallSignatureDeclaration(signatures[0])) {
    return signatures[0]
  }
  return 'refuse'
}

/**
 * Read the identifier name of a declaration node.
 * @param declaration - the declaration to inspect.
 * @returns the identifier text, or undefined when the declaration is anonymous or pattern-named.
 */
export function declarationName(declaration: ts.Node): string | undefined {
  const name = (declaration as ts.NamedDeclaration).name
  if (name && ts.isIdentifier(name)) return name.text
  return undefined
}

/**
 * Check description-prose presence for one labeled declaration: JSDoc must
 * exist and carry prose above its block tags.
 * @param where - the offender label violations open with.
 * @param raw - the declaration's raw JSDoc block ('' if none).
 * @param w - the walk state violations append to.
 */
export function checkDescribed(where: string, raw: string, w: Walk): void {
  if (!raw) w.violations.push(`${where} has no JSDoc.`)
  else if (!parseJsDoc(raw).doc) w.violations.push(`${where} has no description prose above its block tags.`)
}

/**
 * Check the full function contract for one labeled function-like declaration:
 * description prose, `@param` per parameter, `@returns` on a non-void result.
 * @param where - the offender label violations open with.
 * @param raw - the declaration's raw JSDoc block ('' if none).
 * @param parameters - the declaration's parameter list.
 * @param returnType - the return type annotation, or undefined when inferred.
 * @param returnsWaived - suppress the `@returns`/annotation requirement (a
 * declarator-annotated const defers its return contract to the named type).
 * @param w - the walk state violations append to.
 */
export function checkFunctionLike(
  where: string,
  raw: string,
  parameters: readonly ts.ParameterDeclaration[],
  returnType: ts.TypeNode | undefined,
  returnsWaived: boolean,
  w: Walk,
): void {
  if (!raw) { w.violations.push(`${where} has no JSDoc.`); return }
  if (!parseJsDoc(raw).doc) w.violations.push(`${where} has no description prose above its block tags.`)
  const { params, returns } = parseTags(raw)
  checkParams(where, 'exported', parameters, params, w.sf, thisReceiver, w.violations)
  if (!returnsWaived) checkReturns(where, returnType, returns, w.sf, w.violations)
}
