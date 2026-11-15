/** Persistence change classification: which schema transitions need a version bump. */

import { describe, expect, it } from 'vitest'
import { canonicalizeSchema, schemaDigest } from './persistence-schema-model.ts'
import type { PersistenceRoot, SchemaNode } from './persistence-schema-model.ts'
import { classifyPersistenceChange, verifyPersistenceChanges } from './persistence-changes.ts'
import {
  COMPATIBLE_ID, finalize, fixture, inventory, proseFile, runPersistenceChanges, typeRoot, unionBody, versionedEvent,
} from './persistence-changes.spec-helpers.ts'

describe('persistence change classification', () => {
  it.each([1, 2])('acknowledges a higher payload version while preserving %s old variant(s) and the V4 checkpoint', (count) => {
    const root = fixture()
    const variants = [{ version: 0, mode: 'one-shot' }, { version: 0, mode: 'continuable' }].slice(0, count)
    const oldEvent = versionedEvent(variants)
    const nextEvent = versionedEvent([...variants, { version: 1, mode: 'unknown', extra: true }])
    const before = { ...inventory({}, 4), roots: [...inventory({}, 4).roots.filter(root => root.kind !== 'event'), oldEvent] }
    finalize(root, before)
    const after = { ...before, roots: before.roots.map(root => root.kind === 'event' ? nextEvent : root) }
    expect(classifyPersistenceChange(oldEvent, nextEvent))
      .toEqual([expect.objectContaining({ kind: 'payload-version-added', requiresVersionBump: false })])
    runPersistenceChanges(['--record', COMPATIBLE_ID, '--prose', proseFile(root)], root, () => after)
    verifyPersistenceChanges(root, after)
  })

  it('rejects changes to old payloads, missing versions, non-increasing versions, and removal of old readers', () => {
    const variants = [{ version: 0, mode: 'one-shot' }, { version: 0, mode: 'continuable' }]
    const before = versionedEvent(variants)
    for (const after of [
      versionedEvent([...variants, { version: 0, mode: 'unknown' }]),
      versionedEvent([...variants, { version: -1, mode: 'unknown' }]),
      versionedEvent([...variants, { version: 0.5, mode: 'unknown' }]),
      versionedEvent([{ version: 0, mode: 'one-shot', extra: true }, variants[1]!, { version: 1, mode: 'unknown' }]),
      versionedEvent([{ version: 1, mode: 'unknown' }]),
    ]) expect(classifyPersistenceChange(before, after).some(change => change.requiresVersionBump)).toBe(true)
    const expanded = versionedEvent([...variants, { version: 1, mode: 'unknown' }])
    expect(classifyPersistenceChange(expanded, before).some(change => change.requiresVersionBump)).toBe(true)
    expect(classifyPersistenceChange({ ...before, surface: true }, { ...expanded, surface: true })
      .some(change => change.requiresVersionBump)).toBe(true)
    expect(classifyPersistenceChange({ ...before, kind: 'header' }, { ...expanded, kind: 'header' })
      .some(change => change.requiresVersionBump)).toBe(true)
    const unversioned = unionBody([[{ name: 'mode', type: 2, optional: false }]])
    expect(classifyPersistenceChange(unversioned, expanded).some(change => change.requiresVersionBump)).toBe(true)
  })

  it('treats a new optional payload subtree as one additive change even with required descendants', () => {
    const before = typeRoot('event:example/value', { value: 'string' })
    const after = typeRoot('event:example/value', { value: 'string', 'details?': { name: 'string', count: 'number' } })
    expect(classifyPersistenceChange(before, after)).toEqual([{ path: 'event:example/value.data.details', kind: 'optional-property-added', description: 'optional property added', requiresVersionBump: false }])
  })

  it('permits required-to-optional payload properties while rejecting opposite changes, type changes, and removals', () => {
    const required = typeRoot('event:example/value', { value: 'string' })
    const optional = typeRoot('event:example/value', { 'value?': 'string' })
    expect(classifyPersistenceChange(required, optional).every(change => !change.requiresVersionBump)).toBe(true)
    for (const after of [required, typeRoot('event:example/value', { 'value?': 'number' }), typeRoot('event:example/value', {})]) {
      expect(classifyPersistenceChange(optional, after).some(change => change.requiresVersionBump)).toBe(true)
    }
  })

  it('pairs multiple discriminated union arms when a shared payload gains an optional property', () => {
    function unionRoot(optional: boolean): PersistenceRoot {
      const nodes: SchemaNode[] = [
        { kind: 'object', indices: [], properties: [{ name: 'data', type: 1, optional: false }] },
        { kind: 'union', types: [2, 3] },
        { kind: 'object', indices: [], properties: [{ name: 'kind', type: 4, optional: false }, { name: 'payload', type: 6, optional: false }] },
        { kind: 'object', indices: [], properties: [{ name: 'kind', type: 5, optional: false }, { name: 'payload', type: 6, optional: false }] },
        { kind: 'literal', value: 'left' }, { kind: 'literal', value: 'right' },
        { kind: 'object', indices: [], properties: [{ name: 'value', type: 7, optional: false }, ...(optional ? [{ name: 'label', type: 7, optional: true }] : [])] },
        { kind: 'primitive', type: 'string' },
      ]
      const schema = canonicalizeSchema(nodes, 0)
      return { ...typeRoot('event:example/value', {}), schema, digest: schemaDigest(schema) }
    }
    const differences = classifyPersistenceChange(unionRoot(false), unionRoot(true))
    expect(differences.length).toBeGreaterThan(0)
    expect(differences.every(change => !change.requiresVersionBump)).toBe(true)
  })

  it('allows optional additions across undiscriminated union arms', () => {
    const first = [{ name: 'a', type: 2, optional: false }]
    const second = [{ name: 'b', type: 3, optional: false }]
    const extra = { name: 'x', type: 4, optional: true }
    const differences = classifyPersistenceChange(unionBody([first, second]), unionBody([[...first, extra], [...second, extra]]))
    expect(differences).toEqual([expect.objectContaining({ path: 'event:example/value.data.x', requiresVersionBump: false })])
  })

  it('allows required-to-optional fields across undiscriminated union arms', () => {
    const before = unionBody([[{ name: 'a', type: 2, optional: false }], [{ name: 'b', type: 3, optional: false }]])
    const after = unionBody([[{ name: 'a', type: 2, optional: true }], [{ name: 'b', type: 3, optional: true }]])
    const differences = classifyPersistenceChange(before, after)
    expect(differences.map(change => change.path).sort()).toEqual(['event:example/value.data.a', 'event:example/value.data.b'])
    expect(differences.every(change => change.kind === 'property-made-optional' && !change.requiresVersionBump)).toBe(true)
  })

  it('finds a complete matching when one union arm has multiple additive successors', () => {
    const required = [{ name: 'a', type: 2, optional: false }]
    const optional = [{ name: 'a', type: 2, optional: true }]
    const flexible = [{ name: '0', type: 4, optional: true }, ...optional]
    const constrained = [...required, { name: 'z', type: 4, optional: true }]
    const before = unionBody([required, optional])
    for (const after of [unionBody([flexible, constrained]), unionBody([constrained, flexible])]) {
      const differences = classifyPersistenceChange(before, after)
      expect(differences.length).toBeGreaterThan(0)
      expect(differences.every(change => !change.requiresVersionBump)).toBe(true)
    }
    const noCompleteMatching = unionBody([flexible, [{ name: 'different', type: 4, optional: true }]])
    expect(classifyPersistenceChange(before, noCompleteMatching).some(change => change.requiresVersionBump)).toBe(true)
  })

  it('keeps union cardinality, property removal, new required fields, and value types strict', () => {
    const first = [{ name: 'a', type: 2, optional: false }]
    const second = [{ name: 'b', type: 3, optional: false }]
    const third = [{ name: 'c', type: 4, optional: false }]
    const before = unionBody([first, second])
    const variants = [
      unionBody([first, second, third]),
      unionBody([first]),
      unionBody([first, third]),
      unionBody([[...first, { name: 'x', type: 4, optional: false }], [...second, { name: 'x', type: 4, optional: true }]]),
      unionBody([[{ name: 'a', type: 3, optional: true }], [{ name: 'b', type: 3, optional: true }]]),
    ]
    for (const after of variants) expect(classifyPersistenceChange(before, after).some(change => change.requiresVersionBump)).toBe(true)
  })

  it('checks all recursive union arms without retaining provisional successes between candidates', () => {
    const next = { name: 'next', type: 1, optional: true }
    const first = [{ name: 'a', type: 2, optional: false }, next]
    const second = [{ name: 'b', type: 3, optional: false }, next]
    const extra = { name: 'x', type: 4, optional: true }
    const before = unionBody([first, second])
    const additive = unionBody([[...first, extra], [...second, extra]])
    expect(classifyPersistenceChange(before, additive).every(change => !change.requiresVersionBump)).toBe(true)
    const invalid = unionBody([[...first, extra], [{ name: 'b', type: 2, optional: false }, next, extra]])
    expect(classifyPersistenceChange(before, invalid).some(change => change.requiresVersionBump)).toBe(true)
    expect(classifyPersistenceChange(invalid, before).some(change => change.requiresVersionBump)).toBe(true)
  })

  it('preserves body scope through arrays and tuples and rejects a simultaneous value-type change', () => {
    function wrapped(optional: boolean, primitive: 'string' | 'number' = 'string'): PersistenceRoot {
      const nodes: SchemaNode[] = [
        { kind: 'object', indices: [], properties: [{ name: 'data', type: 1, optional: false }] },
        { kind: 'tuple', elements: [{ type: 2, optional: false, rest: false }] },
        { kind: 'array', element: 3 },
        { kind: 'object', indices: [], properties: [{ name: 'value', type: 4, optional }] },
        { kind: 'primitive', type: primitive },
      ]
      const schema = canonicalizeSchema(nodes, 0)
      return { ...typeRoot('event:example/value', {}), schema, digest: schemaDigest(schema) }
    }
    expect(classifyPersistenceChange(wrapped(false), wrapped(true)).every(change => !change.requiresVersionBump)).toBe(true)
    expect(classifyPersistenceChange(wrapped(false), wrapped(true, 'number')).some(change => change.requiresVersionBump)).toBe(true)
  })

  it('keeps optional header/envelope properties and surface event additions strict', () => {
    for (const key of ['SessionHeader', 'JsonlHeaderLine', 'SessionEventEnvelope']) {
      expect(classifyPersistenceChange(typeRoot(key, {}), typeRoot(key, { 'metadata?': 'string' }))[0]?.requiresVersionBump).toBe(true)
    }
    const added = typeRoot('event:example/added', { value: 'string' })
    expect(classifyPersistenceChange(null, added)[0]?.requiresVersionBump).toBe(false)
    expect(classifyPersistenceChange(null, { ...added, surface: true })[0]?.requiresVersionBump).toBe(true)
    expect(classifyPersistenceChange(added, null)[0]?.requiresVersionBump).toBe(true)
  })
})
