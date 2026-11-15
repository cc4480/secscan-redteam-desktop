/** Packed-tarball inspection and dependency rewriting for the npm baseline pipeline. */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { CommandRunner } from './publish-npm-baseline-command.ts'
import { expectString, isRecord } from './publish-npm-baseline-json.ts'

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

/** Which tree a published package came from. */
export type PackageOrigin = 'harness' | 'vendor'

/** One tarball recorded in a release manifest. */
export interface PackedPackage {
  name: string
  tarball: string
  sha256: string
  integrity: string
  origin: PackageOrigin
}

/** The package manifest and file list read back out of one tarball. */
export interface InspectedTarball {
  name: string
  version: string
  private: unknown
  manifest: Record<string, unknown>
  files: string[]
}

/**
 * Read the manifest and file list out of one tarball.
 * @param path - absolute path of the tarball.
 * @param runner - runner used for the `tar` reads.
 * @returns the identity and contents of the tarball.
 */
export function inspectTarball(path: string, runner: CommandRunner): InspectedTarball {
  const manifest: unknown = JSON.parse(
    runner.capture('tar', ['-xOf', path, 'package/package.json'], dirname(path)),
  )
  if (!isRecord(manifest)) throw new Error(`${path} contains an invalid package.json`)
  return {
    name: expectString(manifest, 'name', path),
    version: expectString(manifest, 'version', path),
    private: manifest.private,
    manifest,
    files: runner.capture('tar', ['-tf', path], dirname(path)).split(/\r?\n/),
  }
}

/**
 * Describe one tarball on disk as a release-manifest package.
 * @param name - the package name it must publish as.
 * @param path - absolute path of the tarball.
 * @param origin - which tree it was packed from.
 * @returns the checksummed manifest entry.
 */
export function packedPackage(name: string, path: string, origin: PackageOrigin): PackedPackage {
  const bytes = readFileSync(path)
  return {
    name,
    tarball: basename(path),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    origin,
  }
}

/**
 * Validate one package entry read back from a release manifest.
 * @param value - the raw manifest entry.
 * @param index - its position, used in validation errors.
 * @returns the validated entry.
 */
export function parsePackedPackage(value: unknown, index: number): PackedPackage {
  if (!isRecord(value)) throw new Error(`invalid release manifest package at index ${index}`)
  const context = `release manifest package at index ${index}`
  const name = expectString(value, 'name', context)
  const origin = value.origin === undefined ? 'harness' : value.origin
  if (origin !== 'harness' && origin !== 'vendor') {
    throw new Error(`invalid package origin in release manifest: ${JSON.stringify(origin)}`)
  }
  if (origin === 'harness' && (!name.startsWith('@deepseek-ai/') || name === '@deepseek-ai/dsh-root')) {
    throw new Error(`invalid package name in release manifest: ${name}`)
  }
  return {
    name,
    tarball: expectString(value, 'tarball', context),
    sha256: expectString(value, 'sha256', context),
    integrity: expectString(value, 'integrity', context),
    origin,
  }
}

/**
 * Test whether any string in a manifest value still names the workspace protocol.
 * @param value - the manifest value to walk.
 * @returns true when a `workspace:` range survives somewhere in the value.
 */
export function containsWorkspaceProtocol(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('workspace:')
  if (Array.isArray(value)) return value.some(containsWorkspaceProtocol)
  return isRecord(value) && Object.values(value).some(containsWorkspaceProtocol)
}

/**
 * Pin every internal dependency of one staged manifest to the release version.
 * @param manifest - the package manifest being staged.
 * @param internalNames - names published in this baseline.
 * @param releaseVersion - the version every internal dependency must reach.
 * @param context - the staged manifest path, used in validation errors.
 */
export function stageInternalDependencies(
  manifest: Record<string, unknown>,
  internalNames: ReadonlySet<string>,
  releaseVersion: string,
  context: string,
): void {
  for (const { dependencies, name } of internalDependencyEntries(manifest, internalNames, context)) {
    dependencies[name] = releaseVersion
  }
}

/**
 * Require every internal dependency of a packed manifest to be pinned exactly.
 * @param manifest - the packed package manifest.
 * @param internalNames - names published in this baseline.
 * @param releaseVersion - the version every internal dependency must carry.
 * @param context - the tarball name, used in validation errors.
 */
export function validateInternalDependencyPins(
  manifest: Record<string, unknown>,
  internalNames: ReadonlySet<string>,
  releaseVersion: string,
  context: string,
): void {
  for (const { section, name, range } of internalDependencyEntries(manifest, internalNames, context)) {
    if (range !== releaseVersion) {
      throw new Error(
        `${context} has internal ${section} ${name}@${String(range)}; `
        + `expected exact version ${releaseVersion}`,
      )
    }
  }
}

function* internalDependencyEntries(
  manifest: Record<string, unknown>,
  internalNames: ReadonlySet<string>,
  context: string,
): Generator<{
  section: typeof DEPENDENCY_SECTIONS[number]
  dependencies: Record<string, unknown>
  name: string
  range: unknown
}> {
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = manifest[section]
    if (dependencies === undefined) continue
    if (!isRecord(dependencies)) throw new Error(`${context} ${section} must be an object`)
    for (const [name, range] of Object.entries(dependencies)) {
      if (!internalNames.has(name)) continue
      yield { section, dependencies, name, range }
    }
  }
}
