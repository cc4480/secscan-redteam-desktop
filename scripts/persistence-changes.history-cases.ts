/** Persistence history verification: the acknowledgement graph, tombstones, and tamper rejection. */

import { describe, expect, it } from 'vitest'
import { parsePersistenceSnapshot, validatePersistenceHistory } from './persistence-changes.ts'
import type { PersistenceChangeRecord } from './persistence-changes.ts'
import { BASE_ID, NEXT_ID, entry, inventory, onlyEvent, typeRoot } from './persistence-changes.spec-helpers.ts'

describe('persistence history verification', () => {
  it('accepts a baseline and a successive optional addition without comparing the historical schema to current', () => {
    const before = inventory()
    const after = inventory({ value: 'string', 'label?': 'string' })
    const history = validatePersistenceHistory([entry(BASE_ID, before, null, true), entry(NEXT_ID, onlyEvent(after), BASE_ID)])
    expect(history.tips.get('event:example/value')?.root?.digest).toBe(after.roots[2]?.digest)
    expect(history.tips.get('SessionHeader')?.id).toBe(BASE_ID)
  })

  it('rejects missing predecessors, forks, cycles, duplicates, and missing baseline', () => {
    const base = entry(BASE_ID, inventory(), null, true)
    const next = entry(NEXT_ID, onlyEvent(inventory({ value: 'string', 'label?': 'string' })), BASE_ID)
    expect(() => validatePersistenceHistory([next])).toThrow('exactly one baseline')
    expect(() => validatePersistenceHistory([base, entry(NEXT_ID, next.snapshot, '2026-09-11-missing')])).toThrow('missing predecessor')
    expect(() => validatePersistenceHistory([base, next, entry('2026-09-11-fork', next.snapshot, BASE_ID)])).toThrow('forked')
    expect(() => validatePersistenceHistory([base, base])).toThrow('exactly one baseline')
    const cycle = entry('2026-09-11-cycle', { ...next.snapshot, roots: [typeRoot('event:cycle/event', {})] }, '2026-09-11-cycle')
    expect(() => validatePersistenceHistory([base, cycle])).toThrow('cycle')
  })

  it('binds breaking decisions to the same record header version transition', () => {
    const base = entry(BASE_ID, inventory(), null, true)
    const breaking = inventory({ value: 'number' }, 4)
    expect(() => validatePersistenceHistory([base, entry(NEXT_ID, onlyEvent(breaking), BASE_ID)])).toThrow('requires a format version bump')
    expect(() => validatePersistenceHistory([base, entry(NEXT_ID, onlyEvent(breaking), BASE_ID, false, 'version-bump')])).toThrow("this record's own")
    const touched = { ...breaking, roots: breaking.roots.filter(root => root.key === 'SessionHeader' || root.kind === 'event') }
    expect(validatePersistenceHistory([base, entry(NEXT_ID, touched, BASE_ID, false, 'version-bump')]).tips.get('SessionHeader')?.id).toBe(NEXT_ID)
    const later = entry('2026-09-11-later', onlyEvent(inventory({ value: 'boolean' }, 4)), NEXT_ID, false, 'version-bump')
    expect(() => validatePersistenceHistory([base, entry(NEXT_ID, touched, BASE_ID, false, 'version-bump'), later])).toThrow("this record's own")
  })

  it('retains deletion tombstones and requires re-added roots to continue them', () => {
    const base = entry(BASE_ID, inventory(), null, true)
    const after = inventory({}, 4)
    const header = after.roots[0]!
    const record: PersistenceChangeRecord = { schemaVersion: 1, id: NEXT_ID, baseline: false, changes: [
      { root: 'SessionHeader', previous: BASE_ID, after: header.digest, decision: 'version-bump' },
      { root: 'event:example/value', previous: BASE_ID, after: null, decision: 'version-bump' },
    ] }
    const deletion = { record, snapshot: { ...after, roots: [header] } }
    expect(validatePersistenceHistory([base, deletion]).tips.get('event:example/value')?.root).toBeNull()
    const restored = entry('2026-09-11-restore', onlyEvent(inventory()), NEXT_ID)
    expect(validatePersistenceHistory([base, deletion, restored]).tips.get('event:example/value')?.id).toBe(restored.record.id)
    expect(() => validatePersistenceHistory([base, deletion, entry('2026-09-11-restore', restored.snapshot, null)])).toThrow('forked')
  })

  it('rejects malformed references, unknown schema variants, digest tampering, and extra snapshot roots', () => {
    const schema = inventory()
    const malformed: { roots: readonly { schema: { nodes: readonly unknown[] }; digest: string }[] } = structuredClone(schema)
    malformed.roots[0]!.schema.nodes = [{ kind: 'array', element: 99 }]
    expect(() => parsePersistenceSnapshot(malformed)).toThrow('unknown schema node')
    malformed.roots[0]!.schema.nodes = [{ kind: 'future' }]
    expect(() => parsePersistenceSnapshot(malformed)).toThrow('unknown schema node kind')
    const tampered = structuredClone(schema)
    Object.assign(tampered.roots[0]!, { digest: '0'.repeat(64) })
    expect(() => parsePersistenceSnapshot(tampered)).toThrow('digest mismatch')
    expect(() => parsePersistenceSnapshot({ ...schema, formatVersion: 3 })).toThrow('normalization version')
    const next = entry(NEXT_ID, onlyEvent(inventory({ value: 'string', 'label?': 'string' })), BASE_ID)
    expect(() => validatePersistenceHistory([entry(BASE_ID, schema, null, true), { ...next, snapshot: inventory() }])).toThrow('snapshot roots')
  })
})
