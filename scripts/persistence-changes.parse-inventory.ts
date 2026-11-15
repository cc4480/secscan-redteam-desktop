/** Parsing for persisted schema inventories and acknowledgement documents. */

import { basename } from 'node:path'
import { JSON_SCHEMA, load } from 'js-yaml'
import { schemaDigest } from './persistence-schema-model.ts'
import { EVIDENCE_PLACEHOLDER, EXPLANATION_PLACEHOLDER } from './persistence-changes.constants.ts'
import { array, bool, digest, identifier, keys, parseSchema, record, textValue } from './persistence-changes.parse-schema.ts'
import type { PersistenceChangeRecord } from './persistence-changes.record-types.ts'
import type { CanonicalSchema, PersistenceRoot, PersistenceSchemaInventory, SchemaNode } from './persistence-schema-model.ts'

/** Parse a persisted schema inventory, rejecting malformed graphs and digest drift.
 * @param value - JSON read from the current inventory or an enforced acknowledgement snapshot.
 * @returns the validated inventory.
 */
export function parsePersistenceSnapshot(value: unknown): PersistenceSchemaInventory {
  return parseSnapshot(value, false)
}

/** Parse a historical inventory with path-only source references and optional surface operations.
 * @param value - JSON captured from a historical source tree.
 * @returns the validated inventory; current acknowledgements use the strict parser.
 */
export function parseHistoricalPersistenceSnapshot(value: unknown): PersistenceSchemaInventory {
  return parseSnapshot(value, true)
}

function parseSnapshot(value: unknown, historical: boolean): PersistenceSchemaInventory {
  const input = record(value, 'schema inventory')
  keys(input, ['formatVersion', 'roots', 'types'], 'schema inventory')
  if (input.formatVersion !== 1 && input.formatVersion !== 2) throw new Error('unsupported persistence schema normalization version')
  const names = new Set<string>()
  for (const rawRoot of array(input.roots, 'schema roots')) {
    const root = record(rawRoot, 'schema root')
    keys(root, ['key', 'kind', 'digest', 'schema'], 'schema root', ['event', 'surface'])
    const key = textValue(root.key, 'root key')
    if (names.has(key)) throw new Error(`duplicate schema root ${key}`)
    names.add(key)
    if (root.kind === 'event') {
      if (key !== `event:${textValue(root.event, 'event name')}`) throw new Error(`invalid event root key ${key}`)
      bool(root.surface, 'event surface membership')
    } else if ((root.kind !== 'header' || !['SessionHeader', 'JsonlHeaderLine'].includes(key))
      && (root.kind !== 'envelope' || key !== 'SessionEventEnvelope')) throw new Error(`invalid schema root ${key}`)
    if (root.kind !== 'event' && (root.event !== undefined || root.surface !== undefined)) throw new Error(`${key}: non-event metadata`)
    const schema = parseSchema(root.schema, key, input.formatVersion)
    if (root.kind === 'event') validateEventMetadata(schema, String(root.event), root.surface === true, historical)
    if (digest(root.digest, `${key} digest`) !== schemaDigest(schema)) throw new Error(`${key}: schema digest mismatch`)
  }
  for (const rawType of array(input.types, 'schema types')) {
    const type = record(rawType, 'schema type')
    keys(type, ['digest', 'schema', 'names', 'sources'], 'schema type')
    const schema = parseSchema(type.schema, 'shared schema', input.formatVersion)
    if (digest(type.digest, 'shared digest') !== schemaDigest(schema)) throw new Error('shared schema digest mismatch')
    for (const name of array(type.names, 'type names')) textValue(name, 'type name')
    for (const source of array(type.sources, 'type sources')) {
      const location = textValue(source, 'type source')
      if (historical && /:\d+(?::\d+)?$|#L\d+(?:-L\d+)?$/u.test(location)) {
        throw new Error('historical schema sources must omit line numbers')
      }
    }
  }
  return input as unknown as PersistenceSchemaInventory
}

function validateEventMetadata(schema: CanonicalSchema, event: string, surface: boolean, historical: boolean): void {
  const pending = [0]
  const visited = new Set<number>()
  while (pending.length > 0) {
    const index = pending.pop() as number
    if (visited.has(index)) continue
    visited.add(index)
    const node = schema.nodes[index] as SchemaNode
    if (node.kind === 'union') { pending.push(...node.types); continue }
    if (node.kind !== 'object') throw new Error(`${event}: event schema must be an object`)
    const tag = node.properties.find(property => property.name === 'type')
    const value = tag === undefined ? undefined : schema.nodes[tag.type]
    if (tag?.optional !== false || value?.kind !== 'literal' || value.value !== event) throw new Error(`${event}: event schema type does not match its root`)
    const operation = node.properties.find(property => property.name === 'surfaceOp')
    if (surface ? operation === undefined || !historical && operation.optional : operation !== undefined) throw new Error(`${event}: surface metadata does not match its schema`)
  }
}

/** Parse one acknowledgement document's frontmatter and machine block.
 * @param source - document text with normalized line endings.
 * @param filename - document name used in failures and id matching.
 * @param allowIncomplete - accept scaffold placeholders for a record still being authored.
 * @returns the validated machine record.
 */
export function parseDocument(source: string, filename: string, allowIncomplete = false): PersistenceChangeRecord {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(source)
  if (frontmatter === null || record(load(frontmatter[1] as string, { schema: JSON_SCHEMA }), filename).kind !== 'persistence-change') throw new Error(`${filename}: kind must be persistence-change`)
  const openings = [...source.matchAll(/^```yaml persistence-change\s*$/gmu)]
  const block = /^```yaml persistence-change[^\S\n]*\n([\s\S]*?)^```[^\S\n]*$/mu.exec(source)
  if (openings.length !== 1 || block === null) throw new Error(`${filename}: expected exactly one persistence-change block`)
  const input = record(load(block[1] as string, { schema: JSON_SCHEMA }), filename)
  keys(input, ['schemaVersion', 'id', 'baseline', 'changes'], filename)
  if (input.schemaVersion !== 1) throw new Error(`${filename}: unsupported acknowledgement schema version`)
  const id = identifier(input.id, filename)
  if (basename(filename) !== `${id}.md`) throw new Error(`${filename}: record id does not match filename`)
  bool(input.baseline, filename)
  const roots = new Set<string>()
  for (const value of array(input.changes, `${filename} changes`)) {
    const change = record(value, filename)
    keys(change, ['root', 'previous', 'after', 'decision'], filename)
    const root = textValue(change.root, 'changed root')
    if (roots.has(root)) throw new Error(`${filename}: duplicate change for ${root}`)
    roots.add(root)
    if (change.previous !== null) identifier(change.previous, 'previous record')
    if (change.after !== null) digest(change.after, 'after digest')
    if (change.decision !== 'same-version' && change.decision !== 'version-bump') throw new Error(`${filename}: invalid compatibility decision`)
  }
  if (roots.size === 0) throw new Error(`${filename}: changes must not be empty`)
  if (!allowIncomplete && (source.includes(EXPLANATION_PLACEHOLDER) || source.includes(EVIDENCE_PLACEHOLDER))) throw new Error(`${filename}: complete compatibility and verification prose`)
  return input as unknown as PersistenceChangeRecord
}

/** Read the `version` literal a header or payload object declares.
 * @param root - root whose node 0 carries the property, or null for an absent root.
 * @returns the declared integer version, or undefined when the schema has none.
 */
export function headerVersion(root: PersistenceRoot | null): number | undefined {
  if (root === null) return undefined
  const node = root.schema.nodes[0]
  if (node?.kind !== 'object') return undefined
  const property = node.properties.find(item => item.name === 'version')
  if (property === undefined) return undefined
  const version = root.schema.nodes[property.type]
  return version?.kind === 'literal' && typeof version.value === 'number' && Number.isSafeInteger(version.value) ? version.value : undefined
}
