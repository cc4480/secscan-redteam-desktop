/** Assemble and freshness-check the JSON catalog from the recorded resolution. */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collectDependencies, deduplicateDependencies, record, string } from './gen-dependency-catalog-lockfile.ts'
import { LOCK, METADATA, OUT, PACKAGE, REGISTRY, ROOT } from './gen-dependency-catalog-paths.ts'

/** Recorded capture facts describing the npm resolution behind the lockfile. */
export interface ResolutionMetadata {
  capturedAt: string
  npm: string
  node: string
  platform: string
  arch: string
  registry: string
  installStrategy: string
}

function readMetadata(scanRoot: string): ResolutionMetadata {
  const value = record(JSON.parse(readFileSync(resolve(scanRoot, METADATA), 'utf8')), 'resolution metadata')
  if (value['registry'] !== REGISTRY || value['installStrategy'] !== 'hoisted') {
    throw new Error('dependency-catalog: expected the public npm registry and hoisted install strategy')
  }
  return {
    capturedAt: string(value['capturedAt'], 'capturedAt'),
    npm: string(value['npm'], 'npm'),
    node: string(value['node'], 'node'),
    platform: string(value['platform'], 'platform'),
    arch: string(value['arch'], 'arch'),
    registry: value['registry'],
    installStrategy: value['installStrategy'],
  }
}

/**
 * Render the catalog JSON for one resolved lockfile and capture.
 * @param lock - Parsed npm lockfile v3 from the recorded consumer, or one a refresh just captured.
 * @param metadata - Capture facts describing that resolution.
 * @returns Deterministic JSON with one trailing newline.
 */
export function renderCatalog(lock: unknown, metadata: ResolutionMetadata): string {
  const { version, rows } = collectDependencies(lock)
  return `${JSON.stringify({
    package: PACKAGE,
    version,
    requested: `${PACKAGE}@latest`,
    resolution: metadata,
    dependencies: deduplicateDependencies(rows),
  }, null, 2)}\n`
}

/**
 * Compute the JSON catalog without network access or writes.
 * @param scanRoot - Repository root containing the recorded npm resolution.
 * @returns Deterministic JSON with one trailing newline.
 */
export function computeDependencyCatalog(scanRoot: string = ROOT): string {
  return renderCatalog(JSON.parse(readFileSync(resolve(scanRoot, LOCK), 'utf8')), readMetadata(scanRoot))
}

/**
 * Check the generated JSON against the recorded npm resolution.
 * @param scanRoot - Repository root containing the resolution and catalog.
 * @returns Whether the catalog exists and matches its inputs byte for byte.
 */
export function isDependencyCatalogCurrent(scanRoot: string = ROOT): boolean {
  return existsSync(resolve(scanRoot, OUT))
    && readFileSync(resolve(scanRoot, OUT), 'utf8') === computeDependencyCatalog(scanRoot)
}
