/**
 * Fixture construction and cleanup shared by the pinned-release cases: the
 * archive tree, its manifest and record documents, the schema inventories they
 * snapshot, and the canonical digests the record transitions reference.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dump } from 'js-yaml'
import { afterEach } from 'vitest'
import { canonicalizeSchema, schemaDigest } from './persistence-schema-model.ts'
import type { PersistenceRoot, PersistenceSchemaInventory, PersistenceType, SchemaNode } from './persistence-schema-model.ts'
import type { PersistenceReleaseManifest, PersistenceReleaseRecord } from './persistence-releases.ts'

/** Release tags the fixture manifest, records, and per-release artifacts are named after. */
export const TAGS = ['dsh-v0.1.0-alpha.1', 'dsh-v0.1.0-rc.1', 'dsh-v0.1.0-rc.2'] as const

const temporary: string[] = []
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** Canonicalizes one root from its nodes and digests it as a release record references it. */
export function rootSchema(key: string, nodes: readonly SchemaNode[], surface = false): PersistenceRoot {
  const schema = canonicalizeSchema(nodes, 0)
  return {
    key, kind: key.startsWith('event:') ? 'event' : key === 'SessionEventEnvelope' ? 'envelope' : 'header',
    ...(key.startsWith('event:') ? { event: key.slice(6), surface } : {}), schema, digest: schemaDigest(schema),
  }
}

/** The `event:example/value` root, with a payload type the caller varies between releases. */
export function event(value: 'number' | 'string'): PersistenceRoot {
  return rootSchema('event:example/value', [
    { kind: 'object', indices: [], properties: [
      { name: 'type', type: 1, optional: false },
      { name: 'data', type: 2, optional: false },
      { name: 'surfaceOp', type: 3, optional: true },
    ] },
    { kind: 'literal', value: 'example/value' },
    { kind: 'primitive', type: value },
    { kind: 'primitive', type: 'string' },
  ], true)
}

/** Indexes every canonical node of the given roots by digest, as a written schema file does. */
export function inventory(roots: readonly PersistenceRoot[]): PersistenceSchemaInventory {
  const types = new Map<string, PersistenceType>()
  for (const root of roots) {
    for (const [index] of root.schema.nodes.entries()) {
      const schema = canonicalizeSchema(root.schema.nodes, index)
      const digest = schemaDigest(schema)
      types.set(digest, { digest, schema, names: [], sources: [] })
    }
  }
  return { formatVersion: 1, roots, types: [...types.values()] }
}

/** The written archive tree and the in-memory values it was built from. */
export interface Fixture {
  readonly root: string
  readonly directory: string
  readonly manifest: PersistenceReleaseManifest
  readonly records: readonly PersistenceReleaseRecord[]
  readonly snapshots: readonly PersistenceSchemaInventory[]
}

/** Writes one release record as its bilingual document pair, leaving the generated blocks pending. */
export function saveRecord(directory: string, record: PersistenceReleaseRecord): void {
  const block = dump(record, { lineWidth: -1, noRefs: true })
  for (const suffix of ['.md', '.zh.md']) {
    const switcher = suffix === '.md' ? `English | [中文](${record.tag}.zh.md)` : `[English](${record.tag}.md) | 中文`
    writeFileSync(join(directory, record.tag + suffix), [
      '---', 'kind: persistence-release', '---', '', '# Archived release', '', switcher, '',
      '## Summary', '', 'Authored summary and evidence.', '',
      '| Inventory | Count |', '|---|---|',
      '| Reconstructed inventory | <!-- persistence-release-inventory:start -->pending<!-- persistence-release-inventory:end --> |', '',
      '```yaml persistence-release', block.trimEnd(), '```', '',
      '<!-- persistence-release-changes:start -->', '', 'Pending facts.', '', '<!-- persistence-release-changes:end -->', '',
    ].join('\n'))
  }
}

/** Builds a three-release archive of a breaking transition, an unchanged release, and an empty one. */
export function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-persistence-releases-'))
  temporary.push(root)
  const directory = join(root, 'docs/persistence-changes/releases')
  mkdirSync(directory, { recursive: true })
  for (const suffix of ['.md', '.zh.md']) {
    const switcher = suffix === '.md' ? 'English | [中文](README.zh.md)' : '[English](README.md) | 中文'
    writeFileSync(join(directory, 'README' + suffix), [
      '# Releases', '', switcher, '', 'Authored introduction.', '',
      '<!-- persistence-release-index:start -->', '', 'Pending index.', '', '<!-- persistence-release-index:end -->', '',
    ].join('\n'))
  }
  writeFileSync(join(directory, 'README.i18n.yaml'), 'schemaVersion: 1\n')
  const manifest: PersistenceReleaseManifest = {
    schemaVersion: 1, capturedAt: '2026-09-12',
    releases: TAGS.map((tag, index) => ({
      tag, sourceDate: '2026-09-01T10:00:00+08:00', publishedAt: index === 0 ? null : '2026-09-01T03:00:00Z',
      sessionFormatVersion: 0,
    })),
  }
  const before = event('string')
  const after = event('number')
  const header = rootSchema('SessionHeader', [
    { kind: 'object', indices: [], properties: [{ name: 'version', type: 1, optional: false }] }, { kind: 'primitive', type: 'number' },
  ])
  const snapshots = [inventory([
    header, rootSchema('JsonlHeaderLine', [{ kind: 'opaque', reason: 'unknown' }]),
    rootSchema('SessionEventEnvelope', [{ kind: 'object', indices: [], properties: [] }]), before,
  ]), inventory([after]), inventory([])]
  const records = manifest.releases.map((release, index): PersistenceReleaseRecord => ({
    schemaVersion: 1, tag: release.tag, previous: TAGS[index - 1] ?? null,
    sessionFormatVersion: release.sessionFormatVersion,
    changes: snapshots[index]!.roots.map(root => ({ root: root.key, before: index === 0 ? null : before.digest, after: root.digest })),
  }))
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest))
  for (const [index, record] of records.entries()) {
    saveRecord(directory, record)
    writeFileSync(join(directory, record.tag + '.schema.json'), JSON.stringify(snapshots[index]))
    writeFileSync(join(directory, record.tag + '.i18n.yaml'), 'schemaVersion: 1\n')
  }
  return { root, directory, manifest, records, snapshots }
}

/** Overwrites the schema inventory written for one release. */
export function replaceSnapshot(fixture: Fixture, index: number, snapshot: PersistenceSchemaInventory): void {
  writeFileSync(join(fixture.directory, TAGS[index]! + '.schema.json'), JSON.stringify(snapshot))
}

/** Every file of the archive directory, keyed by name, so a run's writes can be compared. */
export function directoryBytes(directory: string): Record<string, string> {
  return Object.fromEntries(readdirSync(directory).map(file => [file, readFileSync(join(directory, file), 'utf8')]))
}
