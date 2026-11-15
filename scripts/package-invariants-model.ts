/** Owner, violation, and manifest records shared by the package-invariant rule modules. */

import { readFileSync } from 'node:fs'

/** Raw package manifest fields the invariant publication rules read. */
export interface PackageManifest {
  name?: string
  dsh?: unknown
  exports?: Record<string, { types?: string; default?: string } | string | null | undefined>
  files?: string[]
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** One package and the files participating in its invariant publication rules. */
export interface PackageInvariantOwner {
  readonly dir: string
  readonly manifestPath: string
  readonly sourcePath: string
  readonly packageName: string
}

/** One gate violation with a repo-relative owner path. */
export interface PackageInvariantViolation {
  readonly path: string
  readonly message: string
}

/**
 * Read and parse one package manifest.
 * @param path - Absolute manifest path.
 * @returns the parsed manifest fields.
 */
export function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

/**
 * Append one violation to the collected list.
 * @param violations - Violations collected so far.
 * @param path - Repo-relative path of the offending file.
 * @param message - Violation text.
 */
export function addViolation(
  violations: PackageInvariantViolation[],
  path: string,
  message: string,
): void {
  violations.push({ path, message })
}
