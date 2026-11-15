/** Dependency closures for package-owned Loader test configs and their fixture modules. */

import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { cordisConfigFiles } from './cordis-config-files.ts'
import type { PackageManifest, PluginReference } from './verify-cordis-config-types.ts'
import {
  missingPluginDependencies,
  packageNameFromSpecifier,
  pluginReferences,
  readManifest,
  root,
} from './verify-cordis-config-shared.ts'

/**
 * Package-owned Loader fixtures resolve named plugins from their package's
 * dependency surface, not from a repository-level test umbrella.
 * @returns one violation per configured package absent from the owner manifest.
 */
export function validatePackageTestResolution(): string[] {
  const referencesByManifest = new Map<string, PluginReference[]>()
  for (const reference of pluginReferences) {
    const manifestPath = packageTestManifestPath(reference.file)
    if (manifestPath === undefined) continue
    const references = referencesByManifest.get(manifestPath) ?? []
    references.push(reference)
    referencesByManifest.set(manifestPath, references)
  }
  return [...referencesByManifest].flatMap(([manifestPath, references]) =>
    packageTestPluginDependencyErrors(manifestPath, readManifest(manifestPath), references))
}

/**
 * Validate the named plugins one package-owned Loader fixture resolves.
 * Self-references use Node package self-resolution; every other package must
 * be an ordinary production or test dependency of the owner.
 * @param manifestPath Repository-relative owner manifest path.
 * @param manifest Parsed owner manifest.
 * @param references Named plugin references from owner-local test configs.
 * @returns Missing dependency diagnostics.
 */
export function packageTestPluginDependencyErrors(
  manifestPath: string,
  manifest: PackageManifest,
  references: readonly PluginReference[],
): string[] {
  return missingPluginDependencies(
    references.filter(reference => packageNameFromSpecifier(reference.name) !== manifest.name),
    { ...manifest.dependencies, ...manifest.devDependencies },
    `${manifestPath} dependencies or devDependencies`,
  )
}

/**
 * Validate imports made by fixture modules adjacent to package-owned Loader
 * configs. These files execute as plain Node/tsx children, so a stale root
 * `node_modules` link must not hide an undeclared dependency.
 * @param repoRoot Repository root to scan.
 * @returns Missing dependency diagnostics.
 */
export function packageTestFixtureDependencyErrors(repoRoot: string = root): string[] {
  const fixtureDirectories = new Set(cordisConfigFiles(repoRoot)
    .filter(file => packageTestManifestPath(file) !== undefined)
    .map(file => dirname(file).replaceAll('\\', '/')))
  if (fixtureDirectories.size === 0) {
    return ['package test fixture dependency scan found no package-owned Loader configs']
  }
  const referencesByManifest = new Map<string, PluginReference[]>()
  let fixtureModuleCount = 0
  for (const fixtureDirectory of fixtureDirectories) {
    const files = globSync([
      `${fixtureDirectory}/**/*.ts`,
      `${fixtureDirectory}/**/*.mjs`,
    ], { cwd: repoRoot })
    fixtureModuleCount += files.length
    for (const file of files) {
      const manifestPath = packageTestManifestPath(file)
      if (manifestPath === undefined) continue
      const references = referencesByManifest.get(manifestPath) ?? []
      const source = readFileSync(resolve(repoRoot, file), 'utf8')
      for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
        references.push({ file: file.replaceAll('\\', '/'), name: imported.fileName })
      }
      referencesByManifest.set(manifestPath, references)
    }
  }
  if (fixtureModuleCount === 0) {
    return ['package test fixture dependency scan found no fixture modules beside Loader configs']
  }
  return [...referencesByManifest].flatMap(([manifestPath, references]) =>
    packageTestPluginDependencyErrors(
      manifestPath,
      readManifest(manifestPath, repoRoot),
      references,
    ))
}

/** Owner manifest for a package-local test path. */
function packageTestManifestPath(file: string): string | undefined {
  const match = /^(packages\/[^/]+\/[^/]+)\/tests(?:\/|$)/.exec(file.replaceAll('\\', '/'))
  return match?.[1] === undefined ? undefined : `${match[1]}/package.json`
}
