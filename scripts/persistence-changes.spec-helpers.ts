/** Shared persistence-history fixtures, temporary trees, and acknowledgements. */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { afterEach } from 'vitest'
import { canonicalizeSchema, schemaDigest } from './persistence-schema-model.ts'
import type { PersistenceRoot, PersistenceSchemaInventory, SchemaNode, SchemaProperty } from './persistence-schema-model.ts'
import { createPersistenceFinalizationCheckpoint } from './persistence-finalization.ts'
import { loadPersistenceHistory, runPersistenceChanges as executePersistenceChanges } from './persistence-changes.ts'
import type { PersistenceHistoryEntry } from './persistence-changes.ts'

/** A fixture schema node tree described compactly in the specs. */
export type Shape = 'string' | 'number' | 'boolean' | { readonly [property: string]: Shape }

/** Run the command with a catalog writer that renders only the current schema. */
export function runPersistenceChanges(
  args: readonly string[], root: string, extract: (root: string) => PersistenceSchemaInventory,
): string {
  return executePersistenceChanges(args, root, extract, (_root, current) => [{
    path: 'docs/persistence-schema.json', content: JSON.stringify(current, null, 2) + '\n',
  }])
}

/** Parse the subset of a command's JSON result that the specs assert on. */
export function jsonResult(source: string): { ok: boolean; files: readonly string[] } {
  return JSON.parse(source) as { ok: boolean; files: readonly string[] }
}

/** Complete bilingual prose for a record authored through `--prose`. */
export const AUTHORED_PROSE = {
  en: { summary: 'Adds optional metadata.', compatibility: 'Readers may omit the metadata.', verification: 'The focused tests passed.' },
  zh: { summary: '添加可选元数据。', compatibility: '读取方可省略元数据。', verification: '定向测试通过。' },
}

/** Write the authored prose file inside `root` and return its path. */
export function proseFile(root: string): string {
  const path = join(root, 'prose.json')
  writeFileSync(path, JSON.stringify(AUTHORED_PROSE))
  return path
}

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** Create a temporary tree with an empty persistence-changes directory. */
export function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-persistence-changes-'))
  roots.push(root)
  mkdirSync(join(root, 'docs/persistence-changes'), { recursive: true })
  return root
}

/** Build one canonical root for `key` from a compact node tree. */
export function typeRoot(key: string, shape: Shape, version = 3): PersistenceRoot {
  const nodes: SchemaNode[] = []
  function add(shape: Shape): number {
    const index = nodes.length
    nodes.push({ kind: 'primitive', type: 'never' })
    nodes[index] = typeof shape === 'string' ? { kind: 'primitive', type: shape } : {
      kind: 'object', indices: [], properties: Object.entries(shape).map(([name, child]) => ({
        name: name.replace(/\?$/u, ''), optional: name.endsWith('?'), type: add(child),
      })),
    }
    return index
  }
  if (key === 'SessionHeader') {
    const index = add(shape)
    const node = nodes[index]
    if (node?.kind !== 'object') throw new Error('header fixture requires an object')
    nodes[index] = { ...node, properties: [...node.properties, { name: 'version', optional: false, type: nodes.length }] }
    nodes.push({ kind: 'literal', value: version })
  } else if (key.startsWith('event:')) {
    add({ data: shape, type: 'string' })
    const node = nodes[0]
    if (node?.kind !== 'object') throw new Error('event fixture requires an object')
    const type = node.properties.find(item => item.name === 'type')?.type
    if (type === undefined) throw new Error('event fixture requires a type property')
    nodes[type] = { kind: 'literal', value: key.slice(6) }
  } else add(shape)
  const schema = canonicalizeSchema(nodes, 0)
  return { key, kind: ['SessionHeader', 'JsonlHeaderLine'].includes(key) ? 'header' : key === 'SessionEventEnvelope' ? 'envelope' : 'event',
    ...(key.startsWith('event:') ? { event: key.slice(6), surface: false } : {}), schema, digest: schemaDigest(schema) }
}

/** Build a four-root inventory whose example event payload is `eventShape`. */
export function inventory(eventShape: Shape = { value: 'string' }, version = 3): PersistenceSchemaInventory {
  return { formatVersion: 1, types: [], roots: [typeRoot('SessionHeader', { id: 'string' }, version), typeRoot('SessionEventEnvelope', { type: 'string' }), typeRoot('event:example/value', eventShape), typeRoot('JsonlHeaderLine', { version: 'number' })] }
}

/** Build one acknowledged history entry over `schema`. */
export function entry(
  id: string, schema: PersistenceSchemaInventory, previous: string | null,
  baseline = false, decision: 'same-version' | 'version-bump' = 'same-version',
): PersistenceHistoryEntry {
  return {
    record: { schemaVersion: 1, id, baseline, changes: schema.roots.map(root => ({
      root: root.key, previous, after: root.digest, decision,
    })) },
    snapshot: schema,
  }
}

export const BASE_ID = '2026-09-11-baseline'
export const NEXT_ID = '2026-09-11-change'
export const FINALIZED_ID = '2026-09-18-finalized-v4'
export const COMPATIBLE_ID = '2026-09-19-compatible-v4'
export const FUTURE_ID = '2026-09-19-future-v5'

/** Record a baseline, then finalize `current` as the accepted format 4 checkpoint. */
export function finalize(root: string, current = inventory({ value: 'number' }, 4)): void {
  baseline(root)
  runPersistenceChanges(['--record', FINALIZED_ID, '--prose', proseFile(root)], root, () => current)
  const checkpoint = createPersistenceFinalizationCheckpoint(loadPersistenceHistory(root), current)
  mkdirSync(join(root, 'docs/persistence-changes/finalized'))
  writeFileSync(join(root, 'docs/persistence-changes/finalized/v4.json'), JSON.stringify(checkpoint))
  for (const suffix of ['.md', '.zh.md']) {
    writeFileSync(join(root, `docs/session-format-status${suffix}`), '```yaml session-format-finalization\nlatestFinalizedVersion: 4\n```\n')
  }
}

/** Read every file in `root` into a path-keyed map. */
export function contents(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  const visit = (directory: string): void => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = posix.join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else files[path] = readFileSync(join(root, path), 'utf8')
    }
  }
  visit('')
  return files
}

/** Keep only the event roots of `schema`. */
export function onlyEvent(schema: PersistenceSchemaInventory): PersistenceSchemaInventory {
  return { ...schema, roots: schema.roots.filter(root => root.kind === 'event') }
}

/** Close both authored placeholders of a generated record pair. */
export function finishDocuments(root: string, id: string): void {
  for (const suffix of ['.md', '.zh.md']) {
    const path = join(root, 'docs/persistence-changes', id + suffix)
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('TODO: explain this change.', 'Optional payload metadata preserves the recorded value.')
      .replaceAll('TODO: record validation evidence.', 'The focused persistence-history tests passed.'))
  }
}

/** Write `schema` as the current-tree inventory document. */
export function commitCurrent(root: string, schema: PersistenceSchemaInventory): void {
  writeFileSync(join(root, 'docs/persistence-schema.json'), JSON.stringify(schema, null, 2) + '\n')
}

/** Record the baseline acknowledgement for `schema` and publish it as current. */
export function baseline(root: string, schema = inventory()): void {
  runPersistenceChanges(['--baseline', BASE_ID], root, () => schema)
  finishDocuments(root, BASE_ID)
  commitCurrent(root, schema)
}

/** Build an event root whose payload data is the union of `arms`. */
export function unionBody(arms: readonly (readonly SchemaProperty[])[]): PersistenceRoot {
  const nodes: SchemaNode[] = [
    { kind: 'object', indices: [], properties: [{ name: 'data', type: 1, optional: false }] },
    { kind: 'union', types: arms.map((_, index) => 5 + index) },
    { kind: 'primitive', type: 'string' },
    { kind: 'primitive', type: 'number' },
    { kind: 'primitive', type: 'boolean' },
    ...arms.map(properties => ({ kind: 'object' as const, indices: [], properties })),
  ]
  const schema = canonicalizeSchema(nodes, 0)
  return { ...typeRoot('event:example/value', {}), schema, digest: schemaDigest(schema) }
}

/** Build an event root whose payload is a union of versioned variants. */
export function versionedEvent(variants: readonly { version: number; mode: string; extra?: boolean }[]): PersistenceRoot {
  const nodes: SchemaNode[] = [
    { kind: 'object', indices: [], properties: [
      { name: 'data', type: variants.length === 1 ? 3 : 1, optional: false },
      { name: 'type', type: 3 + variants.length * 3, optional: false },
    ] },
    { kind: 'union', types: variants.map((_, index) => 3 + index * 3) },
    { kind: 'primitive', type: 'string' },
  ]
  for (const variant of variants) {
    const index = nodes.length
    nodes.push({ kind: 'object', indices: [], properties: [
      { name: 'version', type: index + 1, optional: false },
      { name: 'mode', type: index + 2, optional: false },
      ...(variant.extra ? [{ name: 'extra', type: 2, optional: false }] : []),
    ] }, { kind: 'literal', value: variant.version }, { kind: 'literal', value: variant.mode })
  }
  nodes.push({ kind: 'literal', value: 'example/value' })
  const schema = canonicalizeSchema(nodes, 0)
  return { ...typeRoot('event:example/value', {}), schema, digest: schemaDigest(schema) }
}
