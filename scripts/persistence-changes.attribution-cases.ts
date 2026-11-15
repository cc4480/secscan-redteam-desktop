/** Recorded source compatibility policy: which attribution additions are additive. */

import { describe, expect, it } from 'vitest'
import { classifyPersistenceChange, parsePersistenceSnapshot, validatePersistenceHistory } from './persistence-changes.ts'
import type { PersistenceSchemaInventory } from './persistence-schema-model.ts'
import { attributedRoot, attributionPolicy, EXISTING_SOURCE, NEW_SOURCE } from './persistence-changes.source-fixtures.ts'
import { BASE_ID, NEXT_ID, entry, inventory } from './persistence-changes.spec-helpers.ts'

describe('recorded source compatibility policy', () => {
  it.each(['user', 'developer'] as const)('accepts a qualified new %s source and records its changed digest', (role) => {
    const before = attributedRoot([EXISTING_SOURCE], { role })
    const after = attributedRoot([EXISTING_SOURCE, NEW_SOURCE], { role, policy: attributionPolicy([NEW_SOURCE.kind], role) })
    expect(after.digest).not.toBe(before.digest)
    expect(classifyPersistenceChange(before, after)).toEqual([expect.objectContaining({ kind: 'attribution-kind-added', requiresVersionBump: false })])
    const snapshot: PersistenceSchemaInventory = { formatVersion: 2, roots: [after], types: [] }
    expect(parsePersistenceSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('allows ordinary optional fields in an existing group alongside a qualified addition', () => {
    const before = attributedRoot([EXISTING_SOURCE])
    const after = attributedRoot([{ ...EXISTING_SOURCE, extra: 'optional' }, NEW_SOURCE], { policy: attributionPolicy([NEW_SOURCE.kind]) })
    const changes = classifyPersistenceChange(before, after)
    expect(changes.map(change => change.kind).sort()).toEqual(['attribution-kind-added', 'optional-property-added'])
    expect(changes.every(change => !change.requiresVersionBump)).toBe(true)
  })

  it.each([
    ['unmarked addition', [EXISTING_SOURCE, NEW_SOURCE], { policy: attributionPolicy([]) }],
    ['required existing field', [{ ...EXISTING_SOURCE, extra: 'required' }, NEW_SOURCE], { policy: attributionPolicy([NEW_SOURCE.kind]) }],
    ['changed existing field', [{ ...EXISTING_SOURCE, value: 'number' }, NEW_SOURCE], { policy: attributionPolicy([NEW_SOURCE.kind]) }],
    ['removed existing kind', [NEW_SOURCE], { policy: attributionPolicy([NEW_SOURCE.kind]) }],
    ['renamed existing kind', [{ ...EXISTING_SOURCE, kind: 'renamed' }, NEW_SOURCE], { policy: attributionPolicy([NEW_SOURCE.kind]) }],
    ['unrelated required payload', [EXISTING_SOURCE, NEW_SOURCE], { policy: attributionPolicy([NEW_SOURCE.kind]), extra: true }],
    ['removed promise', [EXISTING_SOURCE, NEW_SOURCE], { policy: null }],
  ] as const)('keeps %s breaking despite qualified additions', (_name, sources, options) => {
    const changes = classifyPersistenceChange(attributedRoot([EXISTING_SOURCE]), attributedRoot(sources, options))
    expect(changes.some(change => change.requiresVersionBump)).toBe(true)
  })

  it('keeps variants within an existing wire-kind group strict', () => {
    const before = attributedRoot([EXISTING_SOURCE])
    const after = attributedRoot([EXISTING_SOURCE, { ...EXISTING_SOURCE, value: 'number' }, NEW_SOURCE], { policy: attributionPolicy([NEW_SOURCE.kind]) })
    expect(classifyPersistenceChange(before, after)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'union-variants-changed', requiresVersionBump: true }),
      expect.objectContaining({ kind: 'attribution-kind-added', requiresVersionBump: false }),
    ]))
  })

  it('treats qualification changes for an existing kind as policy changes', () => {
    const before = attributedRoot([EXISTING_SOURCE])
    const after = attributedRoot([EXISTING_SOURCE], { policy: attributionPolicy([EXISTING_SOURCE.kind]) })
    expect(classifyPersistenceChange(before, after)).toEqual([expect.objectContaining({ kind: 'source-policy-changed', requiresVersionBump: true })])
  })

  it('keeps legacy source transitions strict and never infers promises from the successor', () => {
    const before = attributedRoot([EXISTING_SOURCE], { policy: null })
    const after = attributedRoot([EXISTING_SOURCE, NEW_SOURCE], { policy: attributionPolicy([NEW_SOURCE.kind]) })
    expect(classifyPersistenceChange(before, after).some(change => change.requiresVersionBump)).toBe(true)
    const legacyAfter = attributedRoot([EXISTING_SOURCE, NEW_SOURCE], { policy: null })
    const snapshots = [before, legacyAfter].map(root => ({ formatVersion: 1 as const, roots: [root], types: [] }))
    expect(() => validatePersistenceHistory([
      entry(BASE_ID, snapshots[0]!, null, true), entry(NEXT_ID, snapshots[1]!, BASE_ID),
    ])).toThrow('requires a format version bump')
  })

  it('validates policy-bearing history without source names or type records', () => {
    const before: PersistenceSchemaInventory = { formatVersion: 2, types: [],
      roots: [...inventory().roots.filter(root => root.kind !== 'event'), attributedRoot([EXISTING_SOURCE])],
    }
    const after: PersistenceSchemaInventory = { formatVersion: 2, types: [],
      roots: [attributedRoot([EXISTING_SOURCE, NEW_SOURCE], { policy: attributionPolicy([NEW_SOURCE.kind]) })],
    }
    expect(validatePersistenceHistory([entry(BASE_ID, before, null, true), entry(NEXT_ID, after, BASE_ID)]).tips.get('event:example/source')?.root).toEqual(after.roots[0])
  })

  it.each(['auto-review', 'compact-basic', 'ptc-mode'])('rejects saved qualification of reserved producer kind %s', (kind) => {
    const root = attributedRoot([EXISTING_SOURCE, { kind }], { policy: attributionPolicy([kind]) })
    const snapshot: PersistenceSchemaInventory = { formatVersion: 2, roots: [root], types: [] }
    expect(() => parsePersistenceSnapshot(snapshot)).toThrow('invalid source compatibility')
  })

  it('rejects old-format policy fields, policy tampering, unsupported promises and invalid bindings', () => {
    const root = attributedRoot([EXISTING_SOURCE])
    const snapshot: PersistenceSchemaInventory = { formatVersion: 2, roots: [root], types: [] }
    expect(() => parsePersistenceSnapshot({ ...snapshot, formatVersion: 1 })).toThrow('unknown field compatibility')
    for (const patch of [{ version: 2 }, { policy: 'arbitrary' }, { discriminator: 'type' }, { unknownKinds: 'discard' }]) {
      const tampered = JSON.parse(JSON.stringify(snapshot)) as PersistenceSchemaInventory
      const property = tampered.roots[0]!.schema.nodes.flatMap(node => node.kind === 'object' ? node.properties : []).find(property => property.compatibility !== undefined)!
      Object.assign(property.compatibility!, patch)
      expect(() => parsePersistenceSnapshot(tampered)).toThrow('unsupported source compatibility')
    }
    const wrongRole = attributedRoot([EXISTING_SOURCE], { policy: attributionPolicy([], 'developer') })
    expect(() => parsePersistenceSnapshot({ ...snapshot, roots: [wrongRole] })).toThrow('invalid source compatibility')
    const changedQualification = attributedRoot([EXISTING_SOURCE], { policy: attributionPolicy([EXISTING_SOURCE.kind]) })
    expect(() => parsePersistenceSnapshot({ ...snapshot, roots: [{ ...changedQualification, digest: root.digest }] })).toThrow('digest mismatch')
    const unknownKind = attributedRoot([EXISTING_SOURCE], { policy: attributionPolicy(['absent']) })
    expect(() => parsePersistenceSnapshot({ ...snapshot, roots: [unknownKind] })).toThrow('invalid source compatibility')
  })
})
