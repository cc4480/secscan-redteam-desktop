/** Browser-module declarations read from the workspace manifests. */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { MANIFEST_GLOBS } from './verify-client-package-context.ts'

/** One workspace package's browser-module declaration. */
export interface ClientDeclaration {
  readonly name: string
  readonly manifest: string
  readonly dynamic: boolean
  readonly external: readonly string[]
  readonly runtimeSourceUses: Readonly<Record<string, readonly string[]>>
  /** Exact runtime specifiers used to validate `dsh.client.external` declarations. */
  readonly runtimeSourceSpecifiers: Readonly<Record<string, readonly string[]>>
  /** Informational package dependencies declared by the row. */
  readonly inject: readonly string[]
}

/** Result of reading every workspace browser-module declaration. */
export interface ClientDeclarations {
  readonly declarations: ClientDeclaration[]
  readonly malformed: string[]
}

/** The manifest fields the verifier reads, with unknown values kept unknown. */
export interface Manifest {
  name?: unknown
  dsh?: unknown
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Read browser-module declarations from workspace manifests.
 * @param root - Absolute repository root.
 * @returns Declarations and malformed dsh.client fields.
 */
export function readClientDeclarations(root: string): ClientDeclarations {
  const malformed: string[] = []
  const declarations = globSync(MANIFEST_GLOBS, { cwd: root })
    .map(normalizePath)
    .sort()
    .flatMap(path => readDeclaration(root, path, malformed) ?? [])
  return { declarations, malformed }
}

/**
 * Return the names of the declarations that carry a dynamic `dsh.client` row.
 * @param declarations - Every workspace declaration.
 * @returns The dynamic row names.
 */
export function rowNames(declarations: readonly ClientDeclaration[]): Set<string> {
  return new Set(declarations.filter(entry => entry.dynamic).map(entry => entry.name))
}

/**
 * Return the dynamic row a specifier is supplied by, if any.
 * @param specifier - External specifier, with or without a `/client` suffix.
 * @param rows - The dynamic row names.
 * @returns The supplying row name, or `undefined` when no row answers it.
 */
export function rowPackageOf(specifier: string, rows: ReadonlySet<string>): string | undefined {
  if (rows.has(specifier)) return specifier
  const stripped = stripClientSuffix(specifier)
  return rows.has(stripped) ? stripped : undefined
}

/**
 * Drop the `/client` subpath a browser-module request carries.
 * @param specifier - External specifier.
 * @returns The specifier without its `/client` suffix.
 */
export function stripClientSuffix(specifier: string): string {
  return specifier.endsWith('/client') ? specifier.slice(0, -'/client'.length) : specifier
}

/**
 * Normalize one repository-relative path to `/` separators.
 * @param path - Path as the platform's glob returned it.
 * @returns The same path with `/` separators.
 */
export function normalizePath(path: string): string {
  return path.split(sep).join('/')
}

/**
 * Narrow an unknown manifest field to a record.
 * @param value - Field value to test.
 * @returns Whether the value is a non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readDeclaration(
  root: string,
  manifestPath: string,
  malformed: string[],
): ClientDeclaration | undefined {
  const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')) as Manifest
  if (typeof manifest.name !== 'string') return undefined
  const dsh = isRecord(manifest.dsh) ? manifest.dsh : undefined
  const rawClient = dsh?.client
  if (rawClient === undefined) {
    return {
      name: manifest.name, manifest: manifestPath, dynamic: false, external: [], inject: [],
      runtimeSourceUses: {}, runtimeSourceSpecifiers: {},
    }
  }
  if (!isRecord(rawClient)) {
    malformed.push(manifestPath + ': ' + manifest.name + ' dsh.client must be an object')
    return {
      name: manifest.name, manifest: manifestPath, dynamic: false, external: [], inject: [],
      runtimeSourceUses: {}, runtimeSourceSpecifiers: {},
    }
  }
  return {
    name: manifest.name,
    manifest: manifestPath,
    dynamic: true,
    external: stringArray(rawClient.external, manifest.name, manifestPath, 'external', malformed),
    inject: stringArray(rawClient.inject, manifest.name, manifestPath, 'inject', malformed),
    runtimeSourceUses: {},
    runtimeSourceSpecifiers: {},
  }
}

function stringArray(
  value: unknown,
  packageName: string,
  manifestPath: string,
  field: string,
  malformed: string[],
): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    malformed.push(manifestPath + ': ' + packageName + ' dsh.client.' + field + ' must be a string array')
    return []
  }
  return value as string[]
}
