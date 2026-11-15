/** Named-plugin resolution for app overlays and for each workspace Bundle's patch rows. */

import { globSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { bundlePatchPaths } from '../packages/boot/app-boot/src/profile.ts'
import type { PackageManifest, PluginReference } from './verify-cordis-config-types.ts'
import {
  appOverlayFiles,
  missingPluginDependencies,
  packageNameFromSpecifier,
  pluginReferences,
  readManifest,
  root,
} from './verify-cordis-config-shared.ts'

export function validateAppResolution(): string[] {
  const violations: string[] = []
  const bundleManifests = bundleManifestPaths()
  // App overlays (and any config left under apps/cli/config) resolve from the
  // dsh app's own dependency surface — the runtime resolution mirrors it.
  const appManifest = readManifest('apps/cli/package.json')
  const appDependencies = {
    ...appManifest.dependencies,
    // Runtime resolution includes every in-box bundle's own dependencies.
    // Optional Profile bundles stay outside the app installation until that
    // Profile installs them.
    ...Object.fromEntries(globSync('packages/bundle/*/package.json', { cwd: root })
      .flatMap(file => Object.entries(readManifest(file).dependencies ?? {}))),
  }
  const shipped = new Set(globSync('*.cordis.yml', { cwd: resolve(root, 'apps/cli/config') })
    .map(file => `apps/cli/config/${file}`))
  const appReferences = pluginReferences.filter(reference => shipped.has(reference.file) || appOverlayFiles.has(reference.file))
  violations.push(...missingPluginDependencies(
    appReferences,
    appDependencies,
    'apps/cli/package.json dependencies or a bundle manifest',
  ))
  const appTestReferences = pluginReferences.filter(reference => reference.file.startsWith('apps/cli/tests/'))
  violations.push(...missingPluginDependencies(
    appTestReferences,
    { ...appManifest.dependencies, ...appManifest.devDependencies },
    'apps/cli/package.json dependencies or devDependencies',
  ))
  // Each bundle's patch rows must resolve from that bundle's own dependencies:
  // per-layer resolution anchors on the bundle package directory.
  for (const manifestPath of bundleManifests) {
    const bundleDir = manifestPath.replace(/\/package\.json$/, '')
    const manifest = readManifest(manifestPath)
    const bundle = manifest.dsh?.bundle
    if (bundle === undefined) continue
    const patchFiles = new Set(bundlePatchPaths(resolve(root, bundleDir), bundle)
      .map(file => relative(root, file).replaceAll('\\', '/')))
    const references = pluginReferences.filter(reference => patchFiles.has(reference.file))
    violations.push(...bundlePluginDependencyErrors(manifestPath, manifest, references))
  }
  return violations
}

/**
 * Discover workspace Bundle packages from their manifest declaration.
 * @param repoRoot Repository root to scan.
 * @returns Sorted slash-normalized repository-relative package manifest paths.
 */
export function bundleManifestPaths(repoRoot: string = root): string[] {
  return globSync('packages/*/*/package.json', { cwd: repoRoot })
    .filter(path => readManifest(path, repoRoot).dsh?.bundle?.patch !== undefined)
    .map(path => path.replaceAll('\\', '/'))
    .sort()
}

/**
 * Validate plugin packages referenced by one Bundle patch.
 * @param manifestPath Repository-relative Bundle manifest path.
 * @param manifest Parsed Bundle manifest.
 * @param references Plugin rows read from the Bundle package directory.
 * @returns Missing production dependency diagnostics.
 */
export function bundlePluginDependencyErrors(
  manifestPath: string,
  manifest: PackageManifest,
  references: readonly PluginReference[],
): string[] {
  return missingPluginDependencies(
    // A Bundle may mount its own package (for example, its provider or runtime row).
    references.filter(reference => packageNameFromSpecifier(reference.name) !== manifest.name),
    manifest.dependencies ?? {},
    `${manifestPath} dependencies`,
  )
}
