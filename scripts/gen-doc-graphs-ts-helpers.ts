/**
 * TypeScript AST and type helpers shared by the event-relation scan: expression
 * wrapper peeling, string-literal-union extraction, and declaration predicates.
 */

import ts from 'typescript'

/** Return whether an identifier is the callee of a call, seen through value-preserving wrappers. */
export function isDirectCallee(identifier: ts.Identifier): boolean {
  let current: ts.Node = identifier
  while (
    ts.isParenthesizedExpression(current.parent)
    || ts.isAsExpression(current.parent)
    || ts.isTypeAssertionExpression(current.parent)
    || ts.isNonNullExpression(current.parent)
    || ts.isSatisfiesExpression(current.parent)
  ) {
    current = current.parent
  }
  return ts.isCallExpression(current.parent) && current.parent.expression === current
}

/** Peel syntax-only wrappers that do not change an expression's runtime value. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/** Return every value only when a type is a closed string-literal union. */
export function finiteStringTypeValues(type: ts.Type): Set<string> | undefined {
  if (type.flags & ts.TypeFlags.StringLiteral) {
    return new Set([(type as ts.StringLiteralType).value])
  }
  if (type.flags & ts.TypeFlags.Never) return new Set()
  if (!type.isUnion()) return undefined
  const values = new Set<string>()
  for (const member of type.types) {
    const memberValues = finiteStringTypeValues(member)
    if (!memberValues) return undefined
    addAll(values, memberValues)
  }
  return values
}

/** Return whether a variable declaration belongs to a const declaration list. */
export function isConstDeclaration(declaration: ts.VariableDeclaration): boolean {
  return (declaration.parent.flags & ts.NodeFlags.Const) !== 0
}

/** Return whether a declaration is visible to callers outside its source module. */
export function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => {
    return modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword
  }) ?? false)
}

/** Add every member of source to target. */
export function addAll<T>(target: Set<T>, source: ReadonlySet<T>): void {
  for (const value of source) target.add(value)
}

/** Return the union of two sets without mutating either input. */
export function unionSets<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): Set<T> {
  const out = new Set(left)
  addAll(out, right)
  return out
}
