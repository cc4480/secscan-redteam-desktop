/** Source-entry discovery and runtime use collection for Host faces. */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize, relative, resolve } from 'node:path'
import { WorkspaceTypertGenerator } from '../packages/typert/generator/src/workspace.ts'
import { collectRuntimeLocalSourceSpecifiers } from './verify-client-packages.ts'
import { collectRuntimeSourceExportUses } from './verify-package-dependencies.runtime-exports.ts'
import { addUse, normalizePath, packageNameOf } from './verify-package-dependencies.shared.ts'
import type { HostRuntimeExportUse, WorkspacePackageManifest } from './verify-package-dependencies.types.ts'

function resolveLocal(importer: string, specifier: string): string | undefined {
  const raw = resolve(dirname(importer), specifier)
  const candidates = extname(raw) === ''
    ? [`${raw}.ts`, `${raw}.tsx`, `${raw}.mts`, `${raw}.cts`, join(raw, 'index.ts'), join(raw, 'index.tsx')]
    : [raw, raw.replace(/\.js$/, '.ts'), raw.replace(/\.jsx?$/, '.tsx'), raw.replace(/\.mjs$/, '.mts'), raw.replace(/\.cjs$/, '.cts')]
  return candidates.find(candidate => existsSync(candidate))
}

function nodeExportTargets(value: unknown): string[] {
  if (typeof value === 'string') return /\.[cm]?js$/.test(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(nodeExportTargets)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value)
    .filter(([condition]) => ['node', 'import', 'require', 'default'].includes(condition))
    .flatMap(([, target]) => nodeExportTargets(target))
}

function hasGeneratedHostExport(pkg: WorkspacePackageManifest): boolean {
  const exports = pkg.manifest.exports
  return exports !== null && typeof exports === 'object'
    && nodeExportTargets((exports as Record<string, unknown>)['./typert']).includes('./lib/typert.host.js')
}

/** Generate Host modules in memory, without the build plugin's artifact writes. */
export function generatedHostSources(
  root: string,
  packages: readonly WorkspacePackageManifest[],
): ReadonlyMap<string, string> {
  const selected = packages.filter(hasGeneratedHostExport)
  if (selected.length === 0) return new Map()
  const artifacts = new WorkspaceTypertGenerator(root).generate(selected.map(pkg => pkg.name), ['host'])
  const sources = new Map(artifacts.map(artifact => [artifact.package, artifact.js]))
  for (const pkg of selected) {
    if (!sources.has(pkg.name)) throw new Error(`${pkg.manifestPath}: declared Host Typert export has no generated module`)
  }
  return sources
}

/** Source-backed Node exports; generated Typert artifacts have no standalone source entry. */
function hostSourceEntries(root: string, pkg: WorkspacePackageManifest): string[] {
  const entry = resolve(root, pkg.dir, 'src/index.ts')
  if (!existsSync(entry)) {
    throw new Error(`${pkg.manifestPath}: Host runtime entry ${normalizePath(relative(root, entry))} does not exist`)
  }
  const entries = new Set([entry])
  const exports = pkg.manifest.exports
  if (exports === null || typeof exports !== 'object') return [...entries]
  for (const [subpath, declaration] of Object.entries(exports as Record<string, unknown>)) {
    if (subpath === '.' || subpath === './package.json' || /^\.\/(?:client|src)(?:\/|$)/.test(subpath)) continue
    const types = declaration !== null && typeof declaration === 'object' && 'types' in declaration
      ? declaration.types
      : undefined
    for (const runtime of nodeExportTargets(declaration)) {
      const generatedFace = subpath === './typert' ? 'host' : subpath === './remote' ? 'remote-client' : undefined
      if (generatedFace !== undefined
        && runtime === `./lib/typert.${generatedFace}.js`
        && types === `./lib/typert.${generatedFace}.d.ts`) continue
      const target = typeof types === 'string' && types.startsWith('./lib/types/') ? types : runtime
      if (!target.startsWith('./lib/')) {
        throw new Error(`${pkg.manifestPath}: Host export ${subpath} cannot map ${target} to a source entry`)
      }
      const source = target.replace(/^\.\/lib\/(?:types\/)?/, './src/').replace(/\.d\.([cm]?)ts$/, '.$1js')
      const matched = source.includes('*')
        ? globSync(source.replace(/\.[cm]?js$/, '.{ts,tsx,mts,cts}'), { cwd: resolve(root, pkg.dir) })
          .map(path => resolve(root, pkg.dir, path))
        : [resolveLocal(resolve(root, pkg.manifestPath), source)].filter(path => path !== undefined)
      if (matched.length === 0) {
        throw new Error(`${pkg.manifestPath}: Host export ${subpath} has no source entry for ${target}`)
      }
      for (const path of matched) entries.add(path)
    }
  }
  return [...entries].sort()
}

/**
 * Read authored and generated Host runtime uses for one package.
 * @param root - Repository containing source files and face tsconfigs.
 * @param pkg - Package manifest and directory.
 * @param generatedHostSource - Host module already emitted in memory by a batched Typert pass.
 * @returns package uses and exact export uses observed in the Host face.
 */
export function readHostRuntimeUses(root: string, pkg: WorkspacePackageManifest, generatedHostSource?: string): {
  packageUses: Map<string, string[]>
  exportUses: HostRuntimeExportUse[]
} {
  const packageUses = new Map<string, string[]>()
  const exportUses = new Map<string, HostRuntimeExportUse>()
  const seen = new Set<string>()
  const collect = (displayPath: string, source: string): void => {
    for (const use of collectRuntimeSourceExportUses(displayPath, source)) {
      const name = packageNameOf(use.specifier)
      if (name === undefined) continue
      addUse(packageUses, name, displayPath)
      const fact = { packageName: name, ...use, sourcePath: displayPath }
      exportUses.set(`${use.specifier}\0${use.exportName}\0${displayPath}\0${String(use.line)}\0${String(use.column)}`, fact)
    }
  }
  const visit = (path: string): void => {
    const normalized = normalize(path)
    if (seen.has(normalized)) return
    seen.add(normalized)
    const source = readFileSync(normalized, 'utf8')
    const displayPath = normalizePath(relative(root, normalized))
    collect(displayPath, source)
    for (const specifier of collectRuntimeLocalSourceSpecifiers(normalized, source)) {
      const target = resolveLocal(normalized, specifier)
      if (target !== undefined) visit(target)
    }
  }
  for (const entry of hostSourceEntries(root, pkg)) visit(entry)
  const generated = generatedHostSource ?? generatedHostSources(root, [pkg]).get(pkg.name)
  if (generated !== undefined) collect(`${normalizePath(pkg.dir)}/lib/typert.host.js`, generated)
  return {
    packageUses,
    exportUses: [...exportUses.values()].sort((left, right) =>
      left.packageName.localeCompare(right.packageName)
      || left.specifier.localeCompare(right.specifier)
      || left.exportName.localeCompare(right.exportName)
      || left.sourcePath.localeCompare(right.sourcePath)
      || left.line - right.line
      || left.column - right.column),
  }
}
