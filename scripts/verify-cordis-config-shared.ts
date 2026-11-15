/** Repository root, diagnostic sinks, and primitives shared by the verify-cordis-config checks. */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PackageManifest, PluginReference } from './verify-cordis-config-types.ts'

export const root = resolve(import.meta.dirname, '..')
// These overlays are consumed by the built dsh app, so their bare specifiers
// resolve from apps/cli.
export const appOverlayFiles = new Set([
  ...globSync('apps/cli/config/examples/**/*.yml', { cwd: root }),
])
export const errors: string[] = []
export const pluginReferences: PluginReference[] = []

/** The adaptive directory-picker chooser package (mounts a backend row at boot). */
const CHOOSER_PACKAGE = '@deepseek-ai/dsh-host-directory-picker-auto'

/**
 * The packages the chooser mounts by runtime string (mirror of its exported
 * `BACKEND_PACKAGES` and `SURFACE_PACKAGES`), invisible to yml-row scanning: a
 * composition mounting the chooser must resolve every one, or keyless Linux CI
 * (which only ever resolves `browse`) hides a dropped `-native` dependency
 * until a macOS boot.
 */
const CHOOSER_BACKEND_PACKAGES = [
  '@deepseek-ai/dsh-host-directory-picker-native',
  '@deepseek-ai/dsh-host-directory-picker-browse',
  '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  '@deepseek-ai/dsh-client-ui-directory-picker-native',
]

export function missingPluginDependencies(
  references: readonly PluginReference[],
  dependencies: Readonly<Record<string, string>>,
  dependencyOwner: string,
): string[] {
  const requiredPackages = new Map<string, Set<string>>()
  const require = (packageName: string, file: string): void => {
    const locations = requiredPackages.get(packageName) ?? new Set<string>()
    locations.add(file)
    requiredPackages.set(packageName, locations)
  }
  for (const reference of references) {
    const packageName = packageNameFromSpecifier(reference.name)
    if (packageName === undefined) continue
    require(packageName, reference.file)
    if (packageName === CHOOSER_PACKAGE) {
      for (const backend of CHOOSER_BACKEND_PACKAGES) require(backend, reference.file)
    }
  }
  return [...requiredPackages].flatMap(([packageName, locations]) => packageName in dependencies
    ? []
    : `${[...locations].join(', ')}: ${packageName} must be declared in ${dependencyOwner}`)
}

export function readManifest(path: string, repoRoot: string = root): PackageManifest {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as PackageManifest
}

export function packageNameFromSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || /^[a-z][a-z+.-]*:/i.test(specifier)) return undefined
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined
  }
  return segments[0] || undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}
