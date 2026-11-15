import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import ts from 'typescript'
import { pointer } from './jsdoc.ts'
import {
  checkMemberDocs,
  collectTypeNames,
  findTypeDecl,
  loadFile,
  pasteText,
  report,
  resolveTypeName,
} from './gen-config-catalog-source.ts'
import { lookupPath, parsePath, unwrapExpr } from './gen-config-catalog-lookup.ts'
import { root } from './gen-config-catalog-root.ts'
import {
  applyExport,
  defaultExport,
  findInject,
  findSchemaExpr,
  walkSchemaExpr,
} from './gen-config-catalog-schema.ts'
import { GLOBAL_TYPES, type CatalogEntry, type FileCtx, type Kind, type Paste, type TypeRef } from './gen-config-catalog-types.ts'
import type { World } from './gen-config-catalog-world.ts'

/**
 * Walk every `packages/<group>/<pkg>` entry and build the catalog entries.
 * Hard-errors (aggregated) on any violation listed in the module doc.
 * `scanRoot` defaults to the repo root; tests pass a fixture dir.
 */
export function collectConfigCatalog(scanRoot: string = root): CatalogEntry[] {
  const violations: string[] = []
  const cache = new Map<string, FileCtx>()
  const entries: CatalogEntry[] = []

  // Pre-pass: package name → dir, so schema-path lookups can follow
  // workspace-package imports while individual packages are still being walked.
  const pkgDirByName = new Map<string, string>()
  const pkgExportsByName = new Map<string, unknown>()
  const manifests: { dir: string; pkg: string }[] = []
  for (const manifestRel of globSync('packages/*/*/package.json', { cwd: scanRoot }).map(path => path.split(sep).join('/')).sort()) {
    const dir = manifestRel.slice(0, -'/package.json'.length)
    const manifest = JSON.parse(readFileSync(resolve(scanRoot, manifestRel), 'utf8')) as { name?: string; os?: string[]; cpu?: string[]; exports?: unknown }
    const pkg = manifest.name
    if (!pkg) {
      violations.push(`${manifestRel} has no "name".`)
      continue
    }
    if (manifest.os !== undefined && manifest.cpu !== undefined) {
      // A per-platform native-binary package (npm os/cpu selection) ships no
      // JavaScript at all — nothing to classify, no Config to catalog.
      continue
    }
    pkgDirByName.set(pkg, dir)
    pkgExportsByName.set(pkg, manifest.exports)
    manifests.push({ dir, pkg })
  }
  const world: World = { scanRoot, cache, pkgDirByName, pkgExportsByName }

  for (const { dir, pkg } of manifests) {
    const entryRel = `${dir}/src/index.ts`
    let ctx: FileCtx
    try {
      ctx = loadFile(resolve(scanRoot, entryRel), entryRel, cache)
    } catch {
      // A package without src/index.ts cannot be classified — that is the
      // violation itself; nothing else in this loop body can run without it.
      violations.push(`${pkg}: entry ${entryRel} is missing or unreadable.`)
      continue
    }

    // Classify, mirroring the Loader's unwrapExports: the default export IS
    // the plugin when present; else an exported `apply` makes the module
    // namespace the plugin; else the package is a plain library.
    const dflt = defaultExport(ctx)
    const apply = applyExport(ctx)
    let pluginClass: ts.ClassDeclaration | null = null
    let configParam: ts.ParameterDeclaration | undefined
    let kind: Kind
    let className: string | undefined
    if (dflt && ts.isClassDeclaration(dflt)) {
      className = dflt.name?.text
      if (dflt.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword)) {
        kind = 'seam'
      } else {
        pluginClass = dflt
        const ctor = dflt.members.find(ts.isConstructorDeclaration)
        configParam = ctor?.parameters[1]
        kind = configParam ? 'config' : 'no-config'
      }
    } else if (dflt) {
      configParam = dflt.parameters[1]
      kind = configParam ? 'config' : 'no-config'
    } else if (apply) {
      configParam = apply.parameters[1]
      kind = configParam ? 'config' : 'no-config'
    } else {
      kind = 'library'
    }

    const entry: CatalogEntry = {
      pkg,
      dir,
      entry: entryRel,
      kind,
      inject: kind === 'library' || kind === 'seam' ? [] : findInject(ctx, pluginClass, violations),
      ...className !== undefined ? { className } : {},
    }
    entries.push(entry)
    if (kind !== 'config' || !configParam) continue

    // Resolve the config type and paste its package-local transitive closure.
    if (!configParam.type || !ts.isTypeReferenceNode(configParam.type) || !ts.isIdentifier(configParam.type.typeName)) {
      violations.push(`${pkg}: config parameter type (${pointer(entryRel, ctx.sf, configParam)}) is not a plain type-name reference; declare a named config type.`)
      continue
    }
    const typeName = configParam.type.typeName.text
    entry.configTypeName = typeName
    const pastes: Paste[] = []
    const refs = new Map<string, TypeRef>()
    // A bare name is the fence's whole namespace: two DIFFERENT declarations
    // (or a declaration in one file and an import in another) sharing a name
    // cannot both render unambiguously, so every resolution is identity-checked
    // by source pointer and a collision is a violation, never a silent skip.
    const pastedDeclByName = new Map<string, string>()
    const queue: { name: string; from: FileCtx }[] = [{ name: typeName, from: ctx }]
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      const { name, from } = item
      const resolved = resolveTypeName(from, name, cache, violations)
      if (resolved === null) {
        violations.push(`${pkg}: config declaration references '${name}' (via ${from.rel}), which is neither declared in the package, imported, nor a known global type.`)
        continue
      }
      if ('ref' in resolved) {
        if (name === typeName) {
          violations.push(`${pkg}: config type '${name}' is imported from '${resolved.ref.specifier}'; a plugin's config type must live in its own package.`)
          continue
        }
        if (pastedDeclByName.has(name)) {
          violations.push(`${pkg}: '${name}' resolves to a package-local declaration (${pastedDeclByName.get(name) ?? ''}) in one file and an import from '${resolved.ref.specifier}' in another; rename one so the fence is unambiguous.`)
          continue
        }
        const existing = refs.get(name)
        if (existing && (existing.specifier !== resolved.ref.specifier || existing.imported !== resolved.ref.imported)) {
          violations.push(`${pkg}: '${name}' is imported from both '${existing.specifier}' (${existing.imported}) and '${resolved.ref.specifier}' (${resolved.ref.imported}) across the pasted closure; disambiguate the aliases.`)
          continue
        }
        refs.set(name, resolved.ref)
        continue
      }
      const declKey = pointer(resolved.ctx.rel, resolved.ctx.sf, resolved.decl)
      const prior = pastedDeclByName.get(name)
      if (prior === declKey) continue // same declaration reached again — benign
      if (prior !== undefined) {
        violations.push(`${pkg}: type name '${name}' resolves to two different declarations (${prior} and ${declKey}) across the pasted closure; rename one — a verbatim fence cannot carry two same-named declarations.`)
        continue
      }
      if (refs.has(name)) {
        violations.push(`${pkg}: '${name}' resolves to an import from '${refs.get(name)?.specifier ?? ''}' in one file and a package-local declaration (${declKey}) in another; rename one so the fence is unambiguous.`)
        continue
      }
      pastedDeclByName.set(name, declKey)
      pastes.push({ text: pasteText(resolved.ctx, resolved.decl), source: declKey })
      checkMemberDocs(resolved.ctx, resolved.decl, violations)
      const names = new Set<string>()
      collectTypeNames(resolved.decl, names)
      for (const n of names) {
        if (GLOBAL_TYPES.has(n)) continue
        queue.push({ name: n, from: resolved.ctx })
      }
    }
    entry.pastes = pastes
    entry.refs = [...refs.values()].sort((a, b) => a.alias.localeCompare(b.alias))

    // Statically walk the runtime schema (when one exists) for the subset check.
    const schemaExpr = findSchemaExpr(ctx, pluginClass)
    if (schemaExpr) {
      const { keys, composes } = walkSchemaExpr(world, ctx, unwrapExpr(schemaExpr), `${pkg} (${entryRel})`, violations)
      entry.schemaKeys = keys
      entry.schemaComposes = composes
    } else {
      entry.schemaKeys = null
    }
  }

  // Fold composed schemas' key paths in, then check each path against the type.
  // Only a definite miss fails; types the walk cannot enumerate stay unknown.
  const byName = new Map(entries.map(e => [e.pkg, e]))
  for (const entry of entries) {
    if (entry.kind !== 'config' || entry.schemaKeys === null || entry.schemaKeys === undefined) continue
    const seen = new Set<string>()
    const foldComposed = (e: CatalogEntry): string[] => {
      if (seen.has(e.pkg)) return []
      seen.add(e.pkg)
      const keys = [...e.schemaKeys ?? []]
      for (const composed of e.schemaComposes ?? []) {
        const target = byName.get(composed)
        if (!target) {
          violations.push(`${entry.pkg}: schema intersects '${composed}', which is not a workspace package the walk collected.`)
          continue
        }
        keys.push(...foldComposed(target))
      }
      return keys
    }
    const allKeys = foldComposed(entry)
    const mainPaste = entry.pastes?.[0]
    const mainFile = mainPaste?.source.split(':')[0]
    const mainCtx = mainFile !== undefined ? cache.get(resolve(scanRoot, mainFile)) : undefined
    const mainDecl = mainCtx && entry.configTypeName !== undefined ? findTypeDecl(mainCtx, entry.configTypeName) : null
    if (!mainCtx || !mainDecl) {
      violations.push(`${entry.pkg}: cannot locate config type '${entry.configTypeName ?? ''}' for the schema-path check.`)
      continue
    }
    for (const keyPath of allKeys) {
      if (lookupPath(world, mainCtx, mainDecl, parsePath(keyPath), new Set()) === 'missing') {
        violations.push(`${entry.pkg}: schema validates key '${keyPath}' but config type '${entry.configTypeName ?? ''}' declares no such member — the catalog paste would hide a loader-accepted field.`)
      }
    }
  }

  report(violations)
  return entries.sort((a, b) => a.pkg.localeCompare(b.pkg))
}
