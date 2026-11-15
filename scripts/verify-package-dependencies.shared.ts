/** Constants, specifier classification, and path helpers shared by the package dependency gate. */

import { isBuiltin } from 'node:module'
import { sep } from 'node:path'

/** Gate name used in every diagnostic line. */
export const GATE = 'verify-package-dependencies'
/** Cordis runtime every Host face consumes as a shared peer. */
export const CORDIS = '@deepseek-ai/cordis'

/**
 * Select the workspace range a published package name uses.
 * @param name - Package name declared in a manifest section.
 * @returns the published package range or the vendored range.
 */
export function workspaceRange(name: string): 'workspace:*' | 'workspace:~' {
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-') ? 'workspace:*' : 'workspace:~'
}

/** Manifest glob covering every published package. */
export const RELEASE_MANIFEST_GLOB = 'packages/!(experimental)/*/package.json'
/** Manifest globs covering every workspace package. */
export const WORKSPACE_MANIFEST_GLOBS = [
  'apps/*/package.json',
  'packages/*/*/package.json',
  'vendor/*/package.json',
]

/** Manifest section owning one dependency relationship. */
export type DependencySection = 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'

/**
 * Normalize a repository-relative path to forward slashes.
 * @param path - Path read from a platform-specific source.
 * @returns the path with platform separators replaced.
 */
export function normalizePath(path: string): string {
  return path.split(sep).join('/')
}

/**
 * Read the package name a module specifier imports from.
 * @param specifier - Module specifier as written in source.
 * @returns the package name, or undefined for relative, builtin, and protocol specifiers.
 */
export function packageNameOf(specifier: string): string | undefined {
  if (isBuiltin(specifier) || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')
    || specifier.includes(':') || specifier.includes('*')) {
    return undefined
  }
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined : parts[0]
}

/**
 * List the values that appear more than once.
 * @param values - Values to inspect.
 * @returns the duplicated values in sorted order.
 */
export function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value)
    seen.add(value)
  }
  return [...duplicated].sort()
}

/**
 * Record one source path against a package name.
 * @param target - Package-name to source-path index to extend.
 * @param name - Package imported or referenced by the source.
 * @param path - Repository-relative source path.
 */
export function addUse(target: Map<string, string[]>, name: string, path: string): void {
  const paths = target.get(name) ?? []
  if (!paths.includes(path)) paths.push(path)
  target.set(name, paths)
}
