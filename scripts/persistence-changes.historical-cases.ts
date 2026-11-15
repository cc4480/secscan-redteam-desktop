/** Historical persistence snapshot parsing: the legacy parser's extra allowances. */

import { describe, expect, it } from 'vitest'
import { canonicalizeSchema, schemaDigest } from './persistence-schema-model.ts'
import type { PersistenceSchemaInventory, SchemaNode } from './persistence-schema-model.ts'
import { parseHistoricalPersistenceSnapshot, parsePersistenceSnapshot } from './persistence-changes.ts'

function historicalSurface(operation: 'required' | 'optional' | 'absent', event = 'example/value'): PersistenceSchemaInventory {
  const nodes: SchemaNode[] = [
    { kind: 'object', indices: [], properties: [
      { name: 'type', type: 1, optional: false },
      ...(operation === 'absent' ? [] : [{ name: 'surfaceOp', type: 2, optional: operation === 'optional' }]),
    ] },
    { kind: 'literal', value: event },
    { kind: 'primitive', type: 'string' },
  ]
  const schema = canonicalizeSchema(nodes, 0)
  return { formatVersion: 1, types: [], roots: [{
    key: 'event:example/value', kind: 'event', event: 'example/value', surface: true, schema, digest: schemaDigest(schema),
  }] }
}

describe('historical persistence snapshot parsing', () => {
  it('preserves source paths and fingerprints in historical inventories', () => {
    const snapshot = historicalSurface('required')
    const root = snapshot.roots[0]!
    const sources = ['packages/core/example/src/types.ts']
    const complete = { ...snapshot, types: [{ schema: root.schema, digest: root.digest, names: ['Example'], sources }] }
    expect(parseHistoricalPersistenceSnapshot(complete)).toEqual(complete)
  })

  it.each([':8', ':8:3', '#L8', '#L8-L12'])('rejects source coordinates %s only in historical inventories', (suffix) => {
    const snapshot = historicalSurface('required')
    const root = snapshot.roots[0]!
    const sources = [`packages/core/example/src/types.ts${suffix}`]
    const complete = { ...snapshot, types: [{ schema: root.schema, digest: root.digest, names: [], sources }] }
    expect(() => parseHistoricalPersistenceSnapshot(complete)).toThrow('historical schema sources must omit line numbers')
    expect(parsePersistenceSnapshot(complete)).toEqual(complete)
  })

  it('admits optional surface operations only through the historical parser', () => {
    const snapshot = historicalSurface('optional')
    expect(() => parsePersistenceSnapshot(snapshot)).toThrow('surface metadata')
    expect(parseHistoricalPersistenceSnapshot(snapshot)).toEqual(snapshot)
    expect(parsePersistenceSnapshot(historicalSurface('required'))).toEqual(historicalSurface('required'))
  })

  it('still rejects absent operations, mismatched event tags, and invalid roots', () => {
    expect(() => parseHistoricalPersistenceSnapshot(historicalSurface('absent'))).toThrow('surface metadata')
    expect(() => parseHistoricalPersistenceSnapshot(historicalSurface('optional', 'wrong/tag'))).toThrow('type does not match')
    const snapshot = historicalSurface('optional')
    expect(() => parseHistoricalPersistenceSnapshot({ ...snapshot, roots: snapshot.roots.map(root => ({ ...root, key: 'event:wrong/key' })) })).toThrow('invalid event root key')
    expect(() => parseHistoricalPersistenceSnapshot({ ...snapshot, roots: snapshot.roots.map(root => ({ ...root, surface: false })) })).toThrow('surface metadata')
  })

  it('preserves graph and digest validation in historical mode', () => {
    const snapshot = historicalSurface('optional')
    expect(() => parseHistoricalPersistenceSnapshot({ ...snapshot, roots: snapshot.roots.map(root => ({ ...root, digest: 'f'.repeat(64) })) })).toThrow('digest mismatch')
    expect(() => parseHistoricalPersistenceSnapshot({ ...snapshot, roots: snapshot.roots.map(root => ({ ...root, schema: { root: 0, nodes: [{ kind: 'array', element: 9 }] } })) })).toThrow('unknown schema node')
  })
})
