/** Type display labels, aliases and anchors resolved for one catalog rendering mode. */

import { githubSlug } from './verify-md-links.ts'
import {
  canonicalizeSchema,
  schemaChildren,
  schemaDigest,
  type CanonicalSchema,
  type PersistenceSchemaInventory,
  type PersistenceType,
} from './persistence-schema-model.ts'
import { assertNever, childPath, nodeAt, sourcePath } from './render-persistence-schema-nodes.ts'

/** One type as displayed in a rendered catalog: label, anchor and unambiguous aliases. */
export interface TypeDisplay {
  readonly type: PersistenceType
  readonly label: string
  readonly anchor: string
  readonly aliases: readonly string[]
}

/** Current catalogs use structural links; historical references retain their original labels and anchors. */
export type PersistenceSchemaRendering = 'current' | 'historical'

/**
 * Label historical definitions by their first owning path, keeping the original anchors.
 * @param inventory - complete current-source schemas and declaration metadata.
 * @returns displays keyed by type digest.
 */
export function historicalDisplays(inventory: PersistenceSchemaInventory): Map<string, TypeDisplay> {
  const paths = new Map<string, string>()
  for (const root of inventory.roots) {
    const seen = new Set<number>()
    const visit = (index: number, path: string): void => {
      if (seen.has(index)) return
      seen.add(index)
      const digest = schemaDigest(canonicalizeSchema(root.schema.nodes, index))
      if (!paths.has(digest)) paths.set(digest, path)
      const node = nodeAt(root.schema, index)
      schemaChildren(node).forEach((child, position) => { visit(child, `${path}.${childPath(node, position)}`) })
    }
    visit(0, root.key)
  }
  const labels = inventory.types.map((type) => {
    const node = nodeAt(type.schema, 0)
    const label = node.kind === 'primitive' ? node.type
      : node.kind === 'literal' ? JSON.stringify(node.value)
        : node.kind === 'opaque' ? node.reason
          : type.names[0] ?? paths.get(type.digest) ?? node.kind
    return { type, label }
  })
  const counts = new Map<string, number>()
  for (const { label } of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  const used = new Set<string>()
  return new Map(labels.map(({ type, label: original }) => {
    const label = (counts.get(original) ?? 0) > 1
      ? `${original} (${type.sources[0] ? sourcePath(type.sources[0]) : paths.get(type.digest) ?? 'anonymous'})`
      : original
    const base = `persistence-type-${githubSlug(label)}`
    let anchor = base
    for (let suffix = 2; used.has(anchor); suffix += 1) anchor = `${base}-${String(suffix)}`
    used.add(anchor)
    return [type.digest, { type, label, anchor, aliases: [] }]
  }))
}

/**
 * Describe one node structurally, preferring its own discriminators over field names.
 * @param schema - canonical schema whose node 0 is described.
 * @param includeFields - list every field name instead of only the discriminator tags.
 * @returns the inline label.
 */
export function structuralLabel(schema: CanonicalSchema, includeFields = false): string {
  const node = nodeAt(schema, 0)
  switch (node.kind) {
    case 'primitive': return node.type
    case 'literal': return JSON.stringify(node.value)
    case 'opaque': return node.reason
    case 'object': {
      const tags = ['type', 'kind', 'role', 'form'].flatMap((name) => {
        const property = node.properties.find(candidate => candidate.name === name && !candidate.optional)
        const value = property === undefined ? undefined : nodeAt(schema, property.type)
        return value?.kind === 'literal' ? [`${name}: ${JSON.stringify(value.value)}`] : []
      })
      const fields = tags.length > 0 && !includeFields ? tags : node.properties.map((property) => {
        const tag = tags.find(tag => tag.startsWith(property.name + ':'))
        return tag ?? `${property.name}${property.optional ? '?' : ''}`
      })
      if (fields.length === 0) return '{}'
      return `{ ${fields.slice(0, 4).join(', ')}${fields.length > 4 ? ', …' : ''} }`
    }
    case 'array': return 'array'
    case 'tuple': return `tuple (${String(node.elements.length)} positions)`
    case 'union': return `union (${String(node.types.length)} variants)`
    default: return assertNever(node)
  }
}

/**
 * Label current definitions by structural digest, with unambiguous logical aliases.
 * @param inventory - complete current-source schemas and declaration metadata.
 * @returns displays keyed by type digest.
 */
export function currentDisplays(inventory: PersistenceSchemaInventory): Map<string, TypeDisplay> {
  const roots = new Map<string, string[]>()
  for (const root of inventory.roots) roots.set(root.digest, [...roots.get(root.digest) ?? [], root.key])
  const aliases = new Map<string, Set<string>>()
  const namesByDigest = new Map(inventory.types.map((type) => {
    const names = type.names.filter(name => !inventory.roots.some(root => name.startsWith(root.key + '.') || name.startsWith(root.key + '[')))
    const logicalNames = [...new Set([...names, ...roots.get(type.digest) ?? []])].sort()
    for (const name of logicalNames) {
      for (const value of new Set([name, name.slice(name.lastIndexOf('#') + 1)])) {
        const alias = `persistence-type-${githubSlug(value)}`
        const owners = aliases.get(alias) ?? new Set<string>()
        owners.add(type.digest)
        aliases.set(alias, owners)
      }
    }
    return [type.digest, names.filter(name => !roots.get(type.digest)?.includes(name)).sort()]
  }))
  const types = new Map(inventory.types.map(type => [type.digest, type]))
  const labelFor = (schema: CanonicalSchema, seen: ReadonlySet<string>, includeFields = false): string => {
    const digest = schemaDigest(schema)
    const node = nodeAt(schema, 0)
    if (node.kind === 'primitive' || node.kind === 'literal' || node.kind === 'opaque') return structuralLabel(schema)
    const named = namesByDigest.get(digest)?.find(name => aliases.get(`persistence-type-${githubSlug(name.slice(name.lastIndexOf('#') + 1))}`)?.size === 1)
    if (named !== undefined) return named.slice(named.lastIndexOf('#') + 1)
    if (seen.has(digest) || seen.size >= 4) return structuralLabel(schema, includeFields)
    if (node.kind === 'array') {
      const element = canonicalizeSchema(schema.nodes, node.element)
      const label = labelFor(types.get(schemaDigest(element))?.schema ?? element, new Set(seen).add(digest), includeFields)
      return `${label}[]`
    }
    return structuralLabel(schema, includeFields)
  }
  const labels = inventory.types.map(type => ({ type, label: labelFor(type.schema, new Set()), anchor: `persistence-type-sha256-${type.digest}` }))
  const counts = new Map<string, number>()
  for (const entry of labels) counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1)
  for (const entry of labels) {
    if ((counts.get(entry.label) ?? 0) > 1) entry.label = labelFor(entry.type.schema, new Set(), true)
  }
  const structuralAnchors = new Set(labels.map(entry => entry.anchor))
  return new Map(labels.map(entry => [entry.type.digest, {
    ...entry,
    // A logical name shared by different structures has no unambiguous target.
    aliases: [...aliases].filter(([alias, owners]) => owners.size === 1 && owners.has(entry.type.digest) && !structuralAnchors.has(alias))
      .map(([alias]) => alias).sort(),
  }]))
}

/**
 * Resolve the displays for one rendering mode.
 * @param inventory - complete current-source schemas and declaration metadata.
 * @param rendering - explicit mode; current selects structural labels and aliases.
 * @returns displays keyed by type digest.
 */
export function displays(inventory: PersistenceSchemaInventory, rendering: PersistenceSchemaRendering): Map<string, TypeDisplay> {
  return rendering === 'current' ? currentDisplays(inventory) : historicalDisplays(inventory)
}
