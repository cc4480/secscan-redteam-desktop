import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { loadFile, findTypeDecl } from './gen-config-catalog-source.ts'
import type { FileCtx, TypeDecl } from './gen-config-catalog-types.ts'

/** Cross-file resolution context for the schema-path check. */
export interface World {
  scanRoot: string
  cache: Map<string, FileCtx>
  /** Workspace package name → repo-relative package dir. */
  pkgDirByName: Map<string, string>
  /** Exact public export declarations used to verify shared schema imports. */
  pkgExportsByName: Map<string, unknown>
  /** Source-plane TypeScript resolution, loaded only for shared schema imports. */
  compilerOptions?: ts.CompilerOptions
}

/** Resolve an explicitly exported workspace module to its mapped source file. */
export function loadWorkspaceSource(world: World, from: FileCtx, specifier: string): FileCtx {
  const pkg = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
  const dir = world.pkgDirByName.get(pkg)
  if (dir === undefined) throw new Error(`schema import '${specifier}' is not a workspace package`)
  const subpath = specifier === pkg ? '.' : `.${specifier.slice(pkg.length)}`
  const exports = world.pkgExportsByName.get(pkg)
  if (typeof exports !== 'object' || exports === null || Array.isArray(exports)
    || !Object.hasOwn(exports, subpath) || (exports as Record<string, unknown>)[subpath] == null) {
    throw new Error(`workspace package '${pkg}' does not explicitly export '${subpath}'`)
  }
  if (world.compilerOptions === undefined) {
    const parsed = ts.getParsedCommandLineOfConfigFile(resolve(world.scanRoot, 'tsconfig.json'), {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    })
    if (parsed === undefined || parsed.errors.length > 0) {
      throw new Error(`cannot resolve schema import '${specifier}' through the workspace source tsconfig`)
    }
    world.compilerOptions = parsed.options
  }
  const resolved = ts.resolveModuleName(specifier, from.abs, world.compilerOptions, ts.sys).resolvedModule
  if (resolved === undefined) throw new Error(`schema import '${specifier}' has no workspace source mapping`)
  const sourcePath = relative(resolve(world.scanRoot, dir, 'src'), resolved.resolvedFileName)
  if (isAbsolute(sourcePath) || sourcePath === '..' || sourcePath.startsWith(`..${sep}`)
    || !sourcePath.endsWith('.ts') || sourcePath.endsWith('.d.ts')) {
    throw new Error(`schema import '${specifier}' must resolve inside ${dir}/src to a TypeScript source file`)
  }
  const rel = relative(world.scanRoot, resolved.resolvedFileName).split(sep).join('/')
  return loadFile(resolved.resolvedFileName, rel, world.cache)
}

/** Find a directly declared const schema, requiring public exports at imported entries. */
function schemaConst(ctx: FileCtx, name: string, exported: boolean): ts.Expression | null {
  for (const statement of ctx.sf.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue
    if (exported && !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    const declaration = statement.declarationList.declarations.find(item => ts.isIdentifier(item.name) && item.name.text === name)
    if (declaration?.initializer !== undefined) return declaration.initializer
  }
  return null
}

/** Follow only const identities and named value imports; never execute schema factories. */
export function schemaAlias(world: World, ctx: FileCtx, name: string): { ctx: FileCtx; expr: ts.Expression } {
  const local = schemaConst(ctx, name, false)
  if (local !== null) return { ctx, expr: local }
  const imported = ctx.imports.get(name)
  if (imported === undefined || imported.typeOnly || imported.imported === '*' || imported.imported === 'default') {
    throw new Error(`schema alias '${name}' must name a const or named value import`)
  }
  const target = loadWorkspaceSource(world, ctx, imported.specifier)
  const expr = schemaConst(target, imported.imported, true)
  if (expr === null) throw new Error(`schema import '${imported.specifier}' has no exported const '${imported.imported}'`)
  return { ctx: target, expr }
}

/** Load a package-relative import target as a FileCtx. */
export function loadRelative(world: World, from: FileCtx, specifier: string): FileCtx {
  const abs = resolve(dirname(from.abs), specifier)
  const rel = from.rel.slice(0, from.rel.lastIndexOf('/') + 1) + specifier.replace(/^\.\//, '')
  return loadFile(abs, rel, world.cache)
}

/** Find a type declaration EXPORTED (directly or via re-export chains) from a
 * file, following `export … from './x.ts'` and `export * from './x.ts'`. */
export function findExportedTypeDecl(
  world: World,
  ctx: FileCtx,
  name: string,
  seen = new Set<string>(),
): { decl: TypeDecl; ctx: FileCtx } | null {
  const key = `${ctx.abs}#${name}`
  if (seen.has(key)) return null
  seen.add(key)
  const local = findTypeDecl(ctx, name)
  if (local) return { decl: local, ctx }
  for (const stmt of ctx.sf.statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const spec = stmt.moduleSpecifier.text
    if (!spec.startsWith('.') || !spec.endsWith('.ts')) continue
    let lookFor: string | null = null
    if (!stmt.exportClause) {
      lookFor = name // export * from './x.ts'
    } else if (ts.isNamedExports(stmt.exportClause)) {
      const el = stmt.exportClause.elements.find(e => e.name.text === name)
      if (el) lookFor = (el.propertyName ?? el.name).text
    }
    if (lookFor === null) continue
    const hit = findExportedTypeDecl(world, loadRelative(world, ctx, spec), lookFor, seen)
    if (hit) return hit
  }
  return null
}

/** Resolve a referenced type NAME to its declaration: declared locally, via a
 * package-relative import, or via a workspace-package import (entry file +
 * re-export chains). `'unknown'` = external or otherwise out of reach. */
export function declForTypeName(world: World, ctx: FileCtx, name: string): { decl: TypeDecl; ctx: FileCtx } | 'unknown' {
  const local = findTypeDecl(ctx, name)
  if (local) return { decl: local, ctx }
  const imp = ctx.imports.get(name)
  if (!imp) return 'unknown'
  if (imp.specifier.startsWith('.')) {
    if (!imp.specifier.endsWith('.ts')) return 'unknown'
    return findExportedTypeDecl(world, loadRelative(world, ctx, imp.specifier), imp.imported) ?? 'unknown'
  }
  const dir = world.pkgDirByName.get(imp.specifier)
  if (dir === undefined) {
    try {
      const target = loadWorkspaceSource(world, ctx, imp.specifier)
      return findExportedTypeDecl(world, target, imp.imported) ?? 'unknown'
    } catch {
      // External or unsupported declarations remain unknown for type presence;
      // a runtime schema alias reports the same resolution failure separately.
      return 'unknown'
    }
  }
  const entryRel = `${dir}/src/index.ts`
  let entry: FileCtx
  try {
    entry = loadFile(resolve(world.scanRoot, entryRel), entryRel, world.cache)
  } catch {
    // A workspace package without a readable entry is reported by its own
    // classification pass; for a lookup it is out of reach.
    return 'unknown'
  }
  return findExportedTypeDecl(world, entry, imp.imported) ?? 'unknown'
}
