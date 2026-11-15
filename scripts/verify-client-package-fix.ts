/** Mechanical repair of malformed or redundant `dsh.client` declaration entries. */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRecord, rowPackageOf, type Manifest } from './verify-client-package-declarations.ts'
import type { ClientPackageFacts } from './verify-client-package-violations.ts'

interface ManifestDocument {
  readonly path: string
  readonly manifest: Manifest
  changed: boolean
}

/**
 * Repair malformed or redundant `dsh.client` declaration entries.
 * @param root - Absolute repository root.
 * @param facts - Facts used by the verification pass.
 * @returns Repository-relative manifests written by the fixer.
 */
export function fixClientPackageManifests(root: string, facts: ClientPackageFacts): string[] {
  const documents = new Map<string, ManifestDocument>()
  const document = (path: string): ManifestDocument => {
    const cached = documents.get(path)
    if (cached !== undefined) return cached
    const loaded: ManifestDocument = {
      path,
      manifest: JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Manifest,
      changed: false,
    }
    documents.set(path, loaded)
    return loaded
  }

  const baseline = new Set([...facts.platformModules, ...facts.preloadedExternals])
  for (const declaration of facts.declarations.filter(entry => entry.dynamic)) {
    const target = document(declaration.manifest)
    const dsh = isRecord(target.manifest.dsh) ? target.manifest.dsh : undefined
    const client = isRecord(dsh?.client) ? dsh.client : undefined
    if (client === undefined) continue
    target.changed = normalizeClientArray(client, 'inject', () => false) || target.changed
    target.changed = normalizeClientArray(
      client,
      'external',
      value => baseline.has(value) || rowPackageOf(value, new Set([declaration.name])) === declaration.name,
    ) || target.changed
  }

  const changed = [...documents.values()].filter(target => target.changed).sort((left, right) =>
    left.path.localeCompare(right.path))
  for (const target of changed) {
    writeFileSync(resolve(root, target.path), JSON.stringify(target.manifest, null, 2) + '\n')
  }
  return changed.map(target => target.path)
}

function normalizeClientArray(
  client: Record<string, unknown>,
  field: 'external' | 'inject',
  remove: (value: string) => boolean,
): boolean {
  const value = client[field]
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) return false
  const seen = new Set<string>()
  const normalized = value.filter((entry: string) => {
    if (entry === '' || seen.has(entry) || remove(entry)) return false
    seen.add(entry)
    return true
  })
  if (normalized.length === value.length && normalized.every((entry, index) => entry === value[index])) return false
  if (normalized.length === 0) {
    if (field === 'external') delete client.external
    else delete client.inject
  } else {
    client[field] = normalized
  }
  return true
}
