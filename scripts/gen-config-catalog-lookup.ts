import ts from 'typescript'
import { declForTypeName, type World } from './gen-config-catalog-world.ts'
import type { FileCtx } from './gen-config-catalog-types.ts'

/** How a schema key path fared against the declared config type: definitely
 * present, definitely absent, or crossing a type the walk cannot enumerate
 * (only `missing` is a violation — `unknown` must never mis-report). */
export type PathLookup = 'found' | 'missing' | 'unknown'

/** One step of a schema key path: a named member, or an array-element hop. */
export type PathStep = { member: string } | { array: true }

/** Parse a schema key path (`agents[].id`) into member/array steps. */
export function parsePath(path: string): PathStep[] {
  const steps: PathStep[] = []
  for (const seg of path.split('.')) {
    let name = seg
    let arrays = 0
    while (name.endsWith('[]')) {
      name = name.slice(0, -2)
      arrays += 1
    }
    steps.push({ member: name })
    for (let i = 0; i < arrays; i += 1) steps.push({ array: true })
  }
  return steps
}

/** Utility wrappers that pass a member lookup through to their type argument. */
const PASSTHROUGH_WRAPPERS = new Set(['Partial', 'Required', 'Readonly', 'NonNullable'])

/**
 * Walk a schema key path against a declared type. This is a PRESENCE check,
 * not a runtime value check: it answers "does the declared config type have a member
 * here", resolving interfaces (heritage included), type aliases, literals,
 * intersections, unions, arrays, indexed access, pass-through utility
 * wrappers, and type references across package-local and workspace imports.
 * Anything it cannot see through resolves `'unknown'`, never `'missing'`.
 */
export function lookupPath(world: World, ctx: FileCtx, node: ts.Node, steps: PathStep[], seen: Set<string>): PathLookup {
  if (steps.length === 0) return 'found'
  // Guard only named declarations, where recursive types can loop. Structural
  // children can share a source position with their parent, so guarding them
  // would mistake ordinary descent for a cycle.
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    const key = `${ctx.abs}:${node.pos}:${steps.length}`
    if (seen.has(key)) return 'unknown' // recursive type — bail rather than loop
    seen.add(key)
  }
  const step = steps[0]
  if (step === undefined) return 'found'
  // Combine branch results: any found wins, else any unknown taints, else missing.
  const combine = (results: PathLookup[]): PathLookup => {
    if (results.includes('found')) return 'found'
    if (results.includes('unknown')) return 'unknown'
    return 'missing'
  }
  const intoMembers = (members: ts.NodeArray<ts.TypeElement>): PathLookup | null => {
    if (!('member' in step)) return null
    for (const m of members) {
      if (!ts.isPropertySignature(m) || m.name.getText(ctx.sf) !== step.member) continue
      if (steps.length === 1) return 'found'
      return m.type ? lookupPath(world, ctx, m.type, steps.slice(1), seen) : 'unknown'
    }
    return null // not among these members; caller consults heritage/parts
  }
  if (ts.isInterfaceDeclaration(node)) {
    if (!('member' in step)) return 'unknown' // an array step cannot land on an interface
    const direct = intoMembers(node.members)
    if (direct !== null) return direct
    const bases: PathLookup[] = []
    for (const clause of node.heritageClauses ?? []) {
      for (const base of clause.types) {
        if (!ts.isIdentifier(base.expression)) {
          bases.push('unknown')
          continue
        }
        const resolved = declForTypeName(world, ctx, base.expression.text)
        bases.push(resolved === 'unknown' ? 'unknown' : lookupPath(world, resolved.ctx, resolved.decl, steps, seen))
      }
    }
    return bases.length ? combine(bases) : 'missing'
  }
  if (ts.isTypeAliasDeclaration(node)) return lookupPath(world, ctx, node.type, steps, seen)
  if (ts.isTypeLiteralNode(node)) {
    if (!('member' in step)) return 'unknown'
    return intoMembers(node.members) ?? 'missing'
  }
  if (ts.isParenthesizedTypeNode(node)) return lookupPath(world, ctx, node.type, steps, seen)
  if (ts.isIntersectionTypeNode(node)) {
    return combine(node.types.map(t => lookupPath(world, ctx, t, steps, seen)))
  }
  if (ts.isUnionTypeNode(node)) {
    // Presence on a union is only definite when every branch agrees.
    const results = node.types.map(t => lookupPath(world, ctx, t, steps, seen))
    if (results.every(r => r === 'found')) return 'found'
    if (results.every(r => r === 'missing')) return 'missing'
    return 'unknown'
  }
  if (ts.isArrayTypeNode(node)) {
    return 'array' in step ? lookupPath(world, ctx, node.elementType, steps.slice(1), seen) : 'unknown'
  }
  if (ts.isTypeOperatorNode(node)) return lookupPath(world, ctx, node.type, steps, seen)
  if (ts.isIndexedAccessTypeNode(node)) {
    const index = node.indexType
    if (ts.isLiteralTypeNode(index) && ts.isStringLiteral(index.literal)) {
      return lookupPath(world, ctx, node.objectType, [{ member: index.literal.text }, ...steps], seen)
    }
    return 'unknown'
  }
  if (ts.isTypeReferenceNode(node)) {
    let head: ts.EntityName = node.typeName
    while (ts.isQualifiedName(head)) head = head.left
    const name = head.text
    if (PASSTHROUGH_WRAPPERS.has(name) && node.typeArguments?.[0]) {
      return lookupPath(world, ctx, node.typeArguments[0], steps, seen)
    }
    if ((name === 'Array' || name === 'ReadonlyArray') && node.typeArguments?.[0]) {
      return 'array' in step ? lookupPath(world, ctx, node.typeArguments[0], steps.slice(1), seen) : 'unknown'
    }
    if (!ts.isIdentifier(node.typeName)) return 'unknown' // namespace-qualified: out of reach
    const resolved = declForTypeName(world, ctx, name)
    return resolved === 'unknown' ? 'unknown' : lookupPath(world, resolved.ctx, resolved.decl, steps, seen)
  }
  return 'unknown'
}

/** Unwrap `as` / `satisfies` / parenthesized wrappers around an expression. */
export function unwrapExpr(expr: ts.Expression): ts.Expression {
  let e = expr
  while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression
  return e
}
