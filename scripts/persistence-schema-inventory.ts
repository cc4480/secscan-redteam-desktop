/** Assemble SessionEvent envelopes and the canonical persistence inventory from extracted nodes. */

import type { SchemaExtractor } from './persistence-schema-extractor.ts'
import {
  canonicalizeSchema,
  schemaChildren,
  schemaDigest,
  schemaHasCompatibility,
  type PersistenceRoot,
  type PersistenceSchemaInventory,
  type PersistenceType,
  type SchemaNode,
} from './persistence-schema-model.ts'
import { PersistenceSchemaError, compare } from './persistence-schema-shared.ts'
import { validSourceCompatibility } from './persistence-source-policy.ts'

/** One extracted root type to fingerprint. */
export interface RootInput {
  readonly key: string
  readonly kind: PersistenceRoot['kind']
  readonly event?: string
  readonly surface?: boolean
  readonly node: number
}

/**
 * Build the persistent envelope alternative for one SessionEvent.
 * @param extractor - extractor holding the already-converted event node.
 * @param id - schema node id of the event.
 * @param event - event name the envelope must retain.
 * @returns the envelope schema node id.
 */
export function schemaEnvelope(extractor: SchemaExtractor, id: number, event: string): number {
  const node = extractor.nodes[id] as SchemaNode
  if (node.kind === 'union') return extractor.union(node.types.map(type => schemaEnvelope(extractor, type, event)))
  if (node.kind !== 'object') throw new PersistenceSchemaError('persistence schema: SessionEvent must resolve to object alternatives')
  const tag = node.properties.find(property => property.name === 'type')
  const data = node.properties.find(property => property.name === 'data')
  const literal = tag === undefined ? undefined : canonicalizeSchema(extractor.nodes, tag.type).nodes[0]
  if (tag?.optional !== false || data?.optional !== false || literal?.kind !== 'literal' || literal.value !== event) {
    throw new PersistenceSchemaError(`persistence schema: SessionEvent<${JSON.stringify(event)}> must retain its required type and data fields`)
  }
  const string = extractor.nodes.length
  extractor.nodes.push({ kind: 'primitive', type: 'string' })
  const envelope: SchemaNode = {
    kind: 'object',
    properties: node.properties.filter(property => property.name !== 'data')
      .map(property => property.name === 'type' ? { ...property, type: string } : property),
    indices: node.indices,
  }
  extractor.nodes.push(envelope)
  return extractor.nodes.length - 1
}

/**
 * Fingerprint the extracted roots and every reachable type.
 * @param extractor - extractor holding the reachable nodes.
 * @param inputs - root types to fingerprint.
 * @returns the canonical schema inventory.
 */
export function schemaInventory(extractor: SchemaExtractor, inputs: readonly RootInput[]): PersistenceSchemaInventory {
  for (const node of extractor.nodes) {
    if (node.kind !== 'object') continue
    for (const property of node.properties) {
      if (property.compatibility !== undefined && !validSourceCompatibility(extractor.nodes, node, property)) {
        throw new PersistenceSchemaError('persistence schema: invalid source compatibility binding or attribution kinds')
      }
    }
  }
  const roots = inputs.map((input) => {
    const schema = canonicalizeSchema(extractor.nodes, input.node)
    return {
      key: input.key,
      kind: input.kind,
      ...(input.event === undefined ? {} : { event: input.event }),
      ...(input.surface === undefined ? {} : { surface: input.surface }),
      digest: schemaDigest(schema),
      schema,
    }
  })
  const found = new Set<number>()
  const visit = (id: number): void => {
    if (found.has(id)) return
    found.add(id)
    const node = extractor.nodes[id] as SchemaNode
    for (const child of schemaChildren(node)) visit(child)
  }
  for (const input of inputs) visit(input.node)
  const types = new Map<string, { schema: PersistenceType['schema']; names: Set<string>; sources: Set<string> }>()
  for (const id of found) {
    const schema = canonicalizeSchema(extractor.nodes, id)
    const digest = schemaDigest(schema)
    const item = types.get(digest) ?? { schema, names: new Set<string>(), sources: new Set<string>() }
    const declarationMetadata = extractor.declarationMetadata.get(id)
    for (const name of declarationMetadata?.names ?? []) item.names.add(name)
    for (const source of declarationMetadata?.sources ?? []) item.sources.add(source)
    types.set(digest, item)
  }
  return {
    formatVersion: roots.some(root => schemaHasCompatibility(root.schema)) ? 2 : 1,
    roots,
    types: [...types].sort(([left], [right]) => compare(left, right)).map(([digest, item]) => ({
      digest,
      schema: item.schema,
      names: [...item.names].sort(compare),
      sources: [...item.sources].sort(compare),
    })),
  }
}
