import ts from 'typescript'
import { unwrapExpr } from './gen-config-catalog-lookup.ts'
import { schemaAlias, type World } from './gen-config-catalog-world.ts'
import type { FileCtx } from './gen-config-catalog-types.ts'

/**
 * Statically walk a schemastery schema expression to its key paths plus the
 * packages whose schemas an intersect composes. A key path is the top-level
 * key or a nested path through object/array compositions (`agents[].id`).
 * Handles object/union calls, chained refinements, named const schema imports
 * through public workspace source paths, and `z.intersect([X.Config, …])`; errors on
 * anything else, so a schema the walk cannot see fails the gate instead of
 * silently thinning it. Nested values that are neither `object` nor `array`
 * compositions (primitives, unions, dynamic-key dicts) contribute no paths.
 */
export function walkSchemaExpr(
  world: World,
  ctx: FileCtx,
  expr: ts.Expression,
  where: string,
  violations: string[],
  aliases = new Set<string>(),
): { keys: string[]; composes: string[] } {
  const keys: string[] = []
  const composes: string[] = []
  // Nested paths under one object property's VALUE expression: recurse through
  // chained refinements toward the base call, descending into object/array.
  const collectValuePaths = (value: ts.Expression, base: string): void => {
    const call = unwrapExpr(value)
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return
    const method = call.expression.name.text
    if (method === 'object' && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
      for (const prop of call.arguments[0].properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(ctx.sf)
        keys.push(`${base}.${key}`)
        collectValuePaths(prop.initializer, `${base}.${key}`)
      }
      return
    }
    if (method === 'array' && call.arguments[0]) {
      collectValuePaths(call.arguments[0], `${base}[]`)
      return
    }
    const inner = unwrapExpr(call.expression.expression)
    if (ts.isCallExpression(inner)) collectValuePaths(inner, base)
  }
  const visit = (e: ts.Expression): void => {
    const call = unwrapExpr(e)
    if (ts.isIdentifier(call)) {
      const identity = `${ctx.abs}#${call.text}`
      if (aliases.has(identity)) {
        violations.push(`${where}: cyclic schema alias '${call.text}' in ${ctx.rel}.`)
        return
      }
      try {
        const target = schemaAlias(world, ctx, call.text)
        const result = walkSchemaExpr(world, target.ctx, target.expr, where, violations, new Set([...aliases, identity]))
        keys.push(...result.keys)
        composes.push(...result.composes)
      } catch (error) {
        violations.push(`${where}: ${error instanceof Error ? error.message : String(error)}.`)
      }
      return
    }
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) {
      violations.push(`${where}: schema expression is not a statically walkable schemastery call.`)
      return
    }
    const method = call.expression.name.text
    if (method === 'object' && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
      for (const prop of call.arguments[0].properties) {
        if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
          const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(ctx.sf)
          keys.push(key)
          if (ts.isPropertyAssignment(prop)) collectValuePaths(prop.initializer, key)
        } else {
          violations.push(`${where}: schema object property '${prop.getText(ctx.sf)}' is not a plain key.`)
        }
      }
      return
    }
    if (method === 'intersect' && call.arguments[0] && ts.isArrayLiteralExpression(call.arguments[0])) {
      for (const el of call.arguments[0].elements) {
        const part = unwrapExpr(el)
        if (ts.isPropertyAccessExpression(part) && part.name.text === 'Config' && ts.isIdentifier(part.expression)) {
          const imp = ctx.imports.get(part.expression.text)
          if (imp && !imp.specifier.startsWith('.')) { composes.push(imp.specifier); continue }
        }
        if (ts.isCallExpression(part) || ts.isIdentifier(part)) { visit(part); continue }
        violations.push(`${where}: intersect element '${part.getText(ctx.sf)}' is neither a workspace plugin's Config nor an inline schema call.`)
      }
      return
    }
    // A union of objects (discriminated union config): collect keys from all
    // variants. Each variant is visited the same way as an intersect element.
    if (method === 'union' && call.arguments[0] && ts.isArrayLiteralExpression(call.arguments[0])) {
      for (const el of call.arguments[0].elements) {
        const part = unwrapExpr(el)
        if (ts.isCallExpression(part) || ts.isIdentifier(part)) { visit(part); continue }
        violations.push(`${where}: union element '${part.getText(ctx.sf)}' is not a schema call or const alias.`)
      }
      return
    }
    // A chained refinement (`z.object({…}).default(…)` etc.): the keys live on
    // the call the chain hangs off — keep unwrapping toward it.
    const base = unwrapExpr(call.expression.expression)
    if (ts.isCallExpression(base)) { visit(base); return }
    violations.push(`${where}: schema call '${method}' is not object/intersect and hangs off no walkable base call.`)
  }
  visit(expr)
  return { keys, composes }
}

/** Find a plugin's schemastery schema expression: an exported `const Config`
 * in the entry file, else a `static Config` on the plugin class. */
export function findSchemaExpr(ctx: FileCtx, pluginClass: ts.ClassDeclaration | null): ts.Expression | null {
  for (const stmt of ctx.sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    if (!stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === 'Config' && decl.initializer) return decl.initializer
    }
  }
  for (const member of pluginClass?.members ?? []) {
    if (!ts.isPropertyDeclaration(member) || member.name.getText() !== 'Config') continue
    if (!member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) continue
    if (member.initializer) return member.initializer
  }
  return null
}

/** Read an `inject` service-key list: `export const inject = […]` in the entry
 * file, else `static inject = […]` on the plugin class. */
export function findInject(ctx: FileCtx, pluginClass: ts.ClassDeclaration | null, violations: string[]): string[] {
  const fromArray = (expr: ts.Expression, where: string): string[] => {
    if (!ts.isArrayLiteralExpression(expr)) {
      violations.push(`${where}: inject is not a plain string-array literal; teach the generator the new declaration form.`)
      return []
    }
    return expr.elements.map(el => ts.isStringLiteral(el) ? el.text : el.getText(ctx.sf))
  }
  for (const stmt of ctx.sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === 'inject' && decl.initializer) {
        return fromArray(decl.initializer, ctx.rel)
      }
    }
  }
  for (const member of pluginClass?.members ?? []) {
    if (ts.isPropertyDeclaration(member) && member.name.getText() === 'inject' && member.initializer) {
      return fromArray(member.initializer, ctx.rel)
    }
  }
  return []
}

/** Resolve the entry file's default export to its class/function declaration
 * (mirroring the Loader's `unwrapExports`), or null when there is none. */
export function defaultExport(ctx: FileCtx): ts.ClassDeclaration | ts.FunctionDeclaration | null {
  for (const stmt of ctx.sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) {
      const name = stmt.expression.text
      for (const s of ctx.sf.statements) {
        if ((ts.isClassDeclaration(s) || ts.isFunctionDeclaration(s)) && s.name?.text === name) return s
      }
      return null
    }
    if ((ts.isClassDeclaration(stmt) || ts.isFunctionDeclaration(stmt))
      && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) return stmt
  }
  return null
}

/** Find the exported `apply` function declaration in the entry file, or null. */
export function applyExport(ctx: FileCtx): ts.FunctionDeclaration | null {
  for (const stmt of ctx.sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'apply'
      && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return stmt
  }
  return null
}
