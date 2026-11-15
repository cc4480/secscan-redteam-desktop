/** Fixtures shared by the linked persistence-catalog regressions in the sibling `*-cases.ts` modules. */

import { expect } from 'vitest'
import {
  canonicalizeSchema, schemaDigest,
  type PersistenceRoot, type PersistenceSchemaInventory, type PersistenceType, type SchemaNode,
} from './persistence-schema-model.ts'
import { renderPersistenceSchemaDefinitions } from './render-persistence-schema.ts'

/**
 * Build the event root for `event` and register every canonicalized node as a type.
 * @param event Event name encoded in the root key.
 * @param nodes Node table the root and registered types are canonicalized from.
 * @param types Registry receiving each canonicalized node's digest.
 * @param metadata Names and sources attached to the type registered for a node index.
 * @returns The event root whose digest covers the complete node table.
 */
export function eventRoot(
  event: string,
  nodes: readonly SchemaNode[],
  types: Map<string, PersistenceType>,
  metadata: (index: number) => Pick<PersistenceType, 'names' | 'sources'>,
): PersistenceRoot {
  nodes.forEach((_, index) => {
    const schema = canonicalizeSchema(nodes, index)
    const digest = schemaDigest(schema)
    if (!types.has(digest)) types.set(digest, { digest, schema, ...metadata(index) })
  })
  const schema = canonicalizeSchema(nodes, 0)
  return { key: `event:${event}`, kind: 'event', event, surface: false, digest: schemaDigest(schema), schema }
}

/**
 * Build an inventory holding one self-referential object type.
 * @param sources Declared sources recorded on the recursive type.
 * @returns Inventory with the recursion as its only root and type.
 */
export function recursiveFixture(sources: readonly string[] = []): PersistenceSchemaInventory {
  const schema = canonicalizeSchema([{ kind: 'object', properties: [{ name: 'next', type: 0, optional: true }], indices: [] }], 0)
  const digest = schemaDigest(schema)
  return {
    formatVersion: 1,
    roots: [{ key: 'SessionHeader', kind: 'header', digest, schema }],
    types: [{ digest, schema, names: ['Recursive'], sources }],
  }
}

/**
 * Build the two-root inventory whose shared nested definition carries a name.
 * @param optional Whether the shared `reason` property is declared optional.
 * @returns Inventory with `first/event` and `second/event` roots.
 */
export function fixture(optional = true): PersistenceSchemaInventory {
  const types = new Map<string, PersistenceType>()
  const roots = ['first/event', 'second/event'].map((event) => {
    const nodes: SchemaNode[] = [
      { kind: 'object', properties: [{ name: 'type', type: 1, optional: false }, { name: 'data', type: 2, optional: false }], indices: [] },
      { kind: 'literal', value: event },
      { kind: 'object', properties: [{ name: 'error', type: 3, optional: true }], indices: [] },
      { kind: 'object', properties: [{ name: 'reason', type: 4, optional }], indices: [] },
      { kind: 'primitive', type: 'string' },
    ]
    return eventRoot(event, nodes, types, index => ({
      names: index === 3 ? ['ErrorInfo'] : [], sources: index === 3 ? ['packages/core/example/src/types.ts:8'] : [],
    }))
  })
  return { formatVersion: 1, roots, types: [...types.values()] }
}

/**
 * Build an inventory whose roots resolve a union of kind/form arms.
 * @param kinds Literal values each root's union resolves.
 * @param events Event names, one root per entry.
 * @returns Inventory with one root per event.
 */
export function producerFixture(kinds: readonly string[], events: readonly string[]): PersistenceSchemaInventory {
  const types = new Map<string, PersistenceType>()
  const roots = events.map((event) => {
    const nodes: SchemaNode[] = [
      { kind: 'object', properties: [{ name: 'type', type: 1, optional: false }, { name: 'data', type: 2, optional: false }], indices: [] },
      { kind: 'literal', value: event },
      { kind: 'object', properties: [{ name: 'source', type: 3, optional: false }], indices: [] },
      { kind: 'union', types: kinds.map((_, index) => 4 + index * 2) },
      ...kinds.flatMap((kind, index): SchemaNode[] => [
        { kind: 'object', properties: [{ name: 'kind', type: 5 + index * 2, optional: false }], indices: [] },
        { kind: 'literal', value: kind },
      ]),
    ]
    return eventRoot(event, nodes, types, index => ({
      names: index >= 4 && index % 2 === 0 ? [`event:${event}.data.source[${String((index - 4) / 2)}]`] : [], sources: [],
    }))
  })
  return { formatVersion: 1, roots, types: [...types.values()] }
}

/**
 * Render the current-mode definitions section for an inventory.
 * @param inventory Inventory to render.
 * @returns The rendered current definitions section.
 */
export function currentDefinitions(inventory: PersistenceSchemaInventory): string {
  return renderPersistenceSchemaDefinitions(inventory, 'en', undefined, 2, 'current')
}

/**
 * Assert every definition anchor is unique and every reference resolves to one.
 * @param markdown Rendered definitions section.
 */
export function assertLinkedOnce(markdown: string): void {
  const anchors = [...markdown.matchAll(/<a id="([^"]+)"><\/a>/gu)].map(match => match[1])
  expect(new Set(anchors).size).toBe(anchors.length)
  for (const match of markdown.matchAll(/\]\(#(persistence-type-[^)]+)\)/gu)) {
    expect(anchors, `missing target ${match[1]}`).toContain(match[1])
  }
}
