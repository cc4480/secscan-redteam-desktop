/** Scratch persistence roots and reference writers shared by the persistence format cases. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dump } from 'js-yaml'
import { afterEach, expect } from 'vitest'
import { canonicalizeSchema, schemaDigest } from './persistence-schema-model.ts'
import type { PersistenceRoot, PersistenceSchemaInventory, PersistenceType, SchemaNode } from './persistence-schema-model.ts'

/** Every scratch root created by these cases, removed after each test. */
const temporary: string[] = []
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** Build a persistence root from its metadata, nodes, and computed digest. */
export function rootSchema(metadata: Omit<PersistenceRoot, 'schema' | 'digest'>, nodes: readonly SchemaNode[]): PersistenceRoot {
  const schema = canonicalizeSchema(nodes, 0)
  return { ...metadata, schema, digest: schemaDigest(schema) }
}

/** Index every type reachable from the roots as a complete inventory. */
export function completeInventory(roots: readonly PersistenceRoot[]): PersistenceSchemaInventory {
  const types = new Map<string, PersistenceType>()
  for (const root of roots) {
    root.schema.nodes.forEach((_, index) => {
      const schema = canonicalizeSchema(root.schema.nodes, index)
      const digest = schemaDigest(schema)
      types.set(digest, { digest, schema, names: [], sources: [] })
    })
  }
  return { formatVersion: 1, roots, types: [...types.values()] }
}

/** Build a header root declaring one `version` property. */
export function header(key: string, version: number | 'number', optional = false): PersistenceRoot {
  return rootSchema({ key, kind: 'header' }, [
    { kind: 'object', indices: [], properties: [{ name: 'version', type: 1, optional }] },
    version === 'number' ? { kind: 'primitive', type: 'number' } : { kind: 'literal', value: version },
  ])
}

/** Build the complete inventory a fixture reference records for one format version. */
export function inventory(version: number): PersistenceSchemaInventory {
  return completeInventory([
    header('SessionHeader', version), header('JsonlHeaderLine', 'number'),
    rootSchema({ key: 'SessionEventEnvelope', kind: 'envelope' }, [{ kind: 'object', indices: [], properties: [] }]),
    rootSchema({ key: 'event:example/value', kind: 'event', event: 'example/value', surface: false }, [
      { kind: 'object', indices: [], properties: [{ name: 'type', type: 1, optional: false }, { name: 'data', type: 2, optional: false }] },
      { kind: 'literal', value: 'example/value' }, { kind: 'primitive', type: 'string' },
    ]),
  ])
}

/** Write one fixture file under the scratch root. */
export function write(root: string, path: string, content: string): void {
  writeFileSync(join(root, path), content)
}

/** Resolve the schema path one reference version records. */
export function schemaPath(version: number, currentVersion: number): string {
  return version === currentVersion ? 'docs/persistence-schema.json' : `docs/persistence-changes/historical-formats/v${version}.schema.json`
}

/** Replace the recorded schema snapshot of one version. */
export function replaceSnapshot(root: string, version: number, currentVersion: number, snapshot: PersistenceSchemaInventory): void {
  write(root, schemaPath(version, currentVersion), JSON.stringify(snapshot))
}

/** Write one reference record, its bilingual documents, and its schema snapshot. */
export function saveReference(root: string, version: number, currentVersion: number, snapshot = inventory(version)): void {
  const current = version === currentVersion
  const filename = current ? 'persistence-catalog' : `persistence-changes/historical-formats/v${version}`
  const schemaName = current ? 'persistence-schema.json' : `v${version}.schema.json`
  const record = {
    schemaVersion: 1, sessionFormatVersion: version,
    source: version === 1 ? { pullRequest: 3349 } : { tag: 'dsh-v0.1.0-rc.5' },
    roots: Object.fromEntries(snapshot.roots.map(root => [root.key, root.digest])),
  }
  const lines = [
    ...current ? [] : ['---', 'kind: persistence-format', '---', '', '```yaml persistence-format', dump(record).trimEnd(), '```', ''],
    `# Session format v${version}`, '', `[Inventory](${schemaName})`, '', '| Root | Kind | SHA-256 |', '|---|---|---|',
    ...snapshot.roots.map(root => `| \`${root.key}\` | ${root.kind} | \`${root.digest}\` |`), '',
  ]
  for (const suffix of ['.md', '.zh.md']) write(root, `docs/${filename}${suffix}`, lines.join('\n'))
  replaceSnapshot(root, version, currentVersion, snapshot)
}

/** Create a scratch repository whose writer reports the requested format version. */
export function fixture(currentVersion = 3): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-persistence-formats-'))
  temporary.push(root)
  mkdirSync(join(root, 'packages/core/session/src'), { recursive: true })
  mkdirSync(join(root, 'docs/persistence-changes/historical-formats'), { recursive: true })
  write(root, 'packages/core/session/src/types.ts', `export const SESSION_FORMAT_VERSION = ${currentVersion} as const\n`)
  for (let version = 0; version <= currentVersion; version += 1) saveReference(root, version, currentVersion)
  return root
}

/** Replace one occurrence of `from` in a fixture file. */
export function edit(root: string, path: string, from: string, to: string): void {
  const source = readFileSync(join(root, path), 'utf8')
  expect(source).toContain(from)
  write(root, path, source.replace(from, to))
}

/** Apply the same edit to both language variants of one historical document. */
export function editPair(root: string, version: number, from: string, to: string): void {
  for (const suffix of ['.md', '.zh.md']) edit(root, `docs/persistence-changes/historical-formats/v${version}${suffix}`, from, to)
}

/** Add the authored format regions a generated-facts check reads and rewrites. */
export function prepareFacts(root: string, currentVersion = 3): void {
  for (const suffix of ['.md', '.zh.md']) {
    for (let version = 0; version < currentVersion; version += 1) {
      const path = `docs/persistence-changes/historical-formats/v${version}${suffix}`
      const switcher = suffix === '.md' ? `English | [中文](v${version}.zh.md)` : `[English](v${version}.md) | 中文`
      write(root, path, readFileSync(join(root, path), 'utf8') + `\n${switcher}\n\n<!-- persistence-format-schema:start -->\n\nPending schemas.\n\n<!-- persistence-format-schema:end -->\n`)
    }
    const switcher = suffix === '.md' ? 'English | [中文](README.zh.md)' : '[English](README.md) | 中文'
    write(root, `docs/persistence-changes/historical-formats/README${suffix}`, `# Session formats\n\n${switcher}\n\nAuthored context.\n\n<!-- persistence-format-index:start -->\n\nPending formats.\n\n<!-- persistence-format-index:end -->\n`)
  }
}
