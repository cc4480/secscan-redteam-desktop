/** Accepted persistence baseline: finalization checkpoints gate every later acknowledgement. */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyPersistenceChange,
  loadPersistenceHistory,
  runPersistenceChanges as executePersistenceChanges,
  verifyPersistenceChanges,
} from './persistence-changes.ts'
import type { PersistenceTypeChange } from './persistence-changes.ts'
import type { PersistenceSchemaInventory } from './persistence-schema-model.ts'
import { createPersistenceFinalizationCheckpoint, loadPersistenceFinalization } from './persistence-finalization.ts'
import { attributedRoot, attributionPolicy, EXISTING_SOURCE } from './persistence-changes.source-fixtures.ts'
import {
  COMPATIBLE_ID, FINALIZED_ID, FUTURE_ID, baseline, commitCurrent, contents, fixture, finalize, inventory,
  proseFile, runPersistenceChanges, typeRoot,
} from './persistence-changes.spec-helpers.ts'

describe('accepted persistence baseline', () => {
  it('keeps metadata-only catalog regeneration and checkpoint capture independent of publication', () => {
    const root = fixture()
    const current = inventory({ value: 'number' }, 4)
    finalize(root, current)
    const metadata = { ...current, roots: [...current.roots].reverse(), types: [{
      ...current.roots[2]!, names: ['RenamedAlias'], sources: ['packages/example/src/types.ts:99'],
    }].map(({ schema, digest, names, sources }) => ({ schema, digest, names, sources })) }
    commitCurrent(root, metadata)
    expect(runPersistenceChanges(['--check'], root, () => metadata)).toContain('roots match')
    expect(createPersistenceFinalizationCheckpoint(loadPersistenceHistory(root), metadata))
      .toEqual(JSON.parse(readFileSync(join(root, 'docs/persistence-changes/finalized/v4.json'), 'utf8')))
    expect(contents(root)['docs/session-format-status.md']).not.toContain('latestReleasedVersion')
  })

  it.each(['optional field', 'ordinary event'] as const)('allows a V4 %s through a new same-version acknowledgement', (kind) => {
    const root = fixture()
    const current = inventory({ value: 'number' }, 4)
    finalize(root, current)
    const after = kind === 'ordinary event'
      ? { ...current, roots: [...current.roots, typeRoot('event:example/new', {})] }
      : inventory({ value: 'number', 'label?': 'string' }, 4)
    const before = contents(root)
    commitCurrent(root, after)
    expect(() => verifyPersistenceChanges(root, after)).toThrow('unacknowledged persistence type changes')
    runPersistenceChanges(['--record', COMPATIBLE_ID, '--prose', proseFile(root)], root, () => after)
    expect(runPersistenceChanges(['--check'], root, () => after)).toContain('roots match')
    const history = loadPersistenceHistory(root)
    expect(history.entries.find(entry => entry.record.id === COMPATIBLE_ID)?.record.changes)
      .toEqual([expect.objectContaining({ decision: 'same-version' })])
    expect(loadPersistenceFinalization(root, history)?.acceptedRecords.has(COMPATIBLE_ID)).toBe(false)
    for (const [path, value] of Object.entries(before).filter(([path]) => path.startsWith('docs/persistence-changes/'))) {
      expect(readFileSync(join(root, path), 'utf8')).toBe(value)
    }
  })

  it.each(['required field', 'changed type'] as const)('refuses a breaking V4 %s before rendering or writing', (kind) => {
    const root = fixture()
    finalize(root)
    const after = inventory(kind === 'required field' ? { value: 'number', label: 'string' } : { value: 'boolean' }, 4)
    const before = contents(root)
    let rendered = false
    const result = JSON.parse(executePersistenceChanges(['--record', FUTURE_ID, '--json'], root, () => after, () => {
      rendered = true
      return []
    })) as { ok: boolean; code: string; changes: PersistenceTypeChange[] }
    expect(result).toMatchObject({ ok: false, code: 'finalized-format-changed' })
    expect(result.changes.length).toBeGreaterThan(0)
    expect(result.changes.some(change => change.requiresVersionBump)).toBe(true)
    expect(rendered).toBe(false)
    expect(contents(root)).toEqual(before)
    commitCurrent(root, after)
    expect(() => verifyPersistenceChanges(root, after)).toThrow('Breaking changes relative to the accepted Session format 4 baseline')
  })

  it('allows qualified V4 attribution additions through a new same-version acknowledgement', () => {
    const root = fixture()
    const source = attributedRoot([EXISTING_SOURCE])
    const current: PersistenceSchemaInventory = { ...inventory({ value: 'number' }, 4), formatVersion: 2,
      roots: [...inventory({ value: 'number' }, 4).roots, source] }
    finalize(root, current)
    const added = attributedRoot([EXISTING_SOURCE, { kind: 'new-attribution' }], { policy: attributionPolicy(['new-attribution']) })
    const after = { ...current, roots: current.roots.map(root => root.key === source.key ? added : root) }
    expect(classifyPersistenceChange(source, added)).toEqual([expect.objectContaining({ kind: 'attribution-kind-added', requiresVersionBump: false })])
    const before = contents(root)
    runPersistenceChanges(['--record', COMPATIBLE_ID, '--prose', proseFile(root)], root, () => after)
    expect(runPersistenceChanges(['--check'], root, () => after)).toContain('roots match')
    expect(loadPersistenceHistory(root).entries.find(entry => entry.record.id === COMPATIBLE_ID)?.record.changes)
      .toEqual([expect.objectContaining({ decision: 'same-version' })])
    for (const [path, value] of Object.entries(before).filter(([path]) => path.startsWith('docs/persistence-changes/'))) {
      expect(readFileSync(join(root, path), 'utf8')).toBe(value)
    }
  })

  it('keeps later unaccepted compatible records editable and rejects a breaking successor without its own version transition', () => {
    const root = fixture()
    finalize(root)
    const first = inventory({ value: 'number', 'label?': 'string' }, 4)
    runPersistenceChanges(['--record', COMPATIBLE_ID, '--prose', proseFile(root)], root, () => first)
    const amended = inventory({ value: 'number', 'label?': 'string', 'extra?': 'boolean' }, 4)
    runPersistenceChanges(['--update', COMPATIBLE_ID], root, () => amended)
    expect(runPersistenceChanges(['--check'], root, () => amended)).toContain('roots match')
    expect(loadPersistenceFinalization(root, loadPersistenceHistory(root))?.acceptedRecords.has(COMPATIBLE_ID)).toBe(false)
    const breaking = inventory({ value: 'number', 'label?': 'number', 'extra?': 'boolean' }, 4)
    const accepted = inventory({ value: 'number' }, 4).roots[2]!
    expect(classifyPersistenceChange(accepted, breaking.roots[2]!).every(change => !change.requiresVersionBump)).toBe(true)
    const before = contents(root)
    expect(() => runPersistenceChanges(['--record', '2026-09-20-breaking-v4', '--prose', proseFile(root)], root, () => breaking))
      .toThrow("this record's own increasing SessionHeader.version")
    expect(contents(root)).toEqual(before)
  })

  it.each(['compatible', 'breaking'] as const)('refuses a %s update to an accepted acknowledgement', (kind) => {
    const root = fixture()
    finalize(root)
    const after = inventory(kind === 'compatible' ? { value: 'number', 'label?': 'string' } : { value: 'boolean' }, 4)
    const before = contents(root)
    expect(() => runPersistenceChanges(['--update', FINALIZED_ID], root, () => after))
      .toThrow('cannot update finalized acknowledgement')
    expect(contents(root)).toEqual(before)
  })

  it('allows a fresh V5 transition while retaining finalized history', () => {
    const root = fixture()
    finalize(root)
    const before = contents(root)
    const after = inventory({ value: 'boolean' }, 5)
    runPersistenceChanges(['--record', FUTURE_ID, '--prose', proseFile(root)], root, () => after)
    expect(runPersistenceChanges(['--check'], root, () => after)).toContain('roots match')
    for (const [path, value] of Object.entries(before).filter(([path]) => path.startsWith('docs/persistence-changes/'))) {
      expect(readFileSync(join(root, path), 'utf8')).toBe(value)
    }
    expect(() => runPersistenceChanges(['--update', FINALIZED_ID], root, () => after)).toThrow('cannot update finalized acknowledgement')
    const later = inventory({ value: 'string' }, 5)
    expect(() => runPersistenceChanges(['--record', '2026-09-20-without-version', '--prose', proseFile(root)], root, () => later))
      .toThrow("this record's own increasing SessionHeader.version")
  })

  it.each([4, 5])('detects a consistently rewritten accepted record while the writer is V%s', (version) => {
    const root = fixture()
    finalize(root)
    const current = inventory({ value: version === 4 ? 'number' : 'boolean' }, version)
    if (version === 5) runPersistenceChanges(['--record', FUTURE_ID, '--prose', proseFile(root)], root, () => current)
    const snapshotPath = join(root, `docs/persistence-changes/${FINALIZED_ID}.schema.json`)
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as PersistenceSchemaInventory
    const replacement = typeRoot('event:example/value', { value: 'number', extra: 'string' })
    const original = snapshot.roots.find(root => root.key === replacement.key)!
    writeFileSync(snapshotPath, JSON.stringify({ ...snapshot,
      roots: snapshot.roots.map(root => root.key === replacement.key ? replacement : root) }))
    for (const suffix of ['.md', '.zh.md']) {
      const path = join(root, `docs/persistence-changes/${FINALIZED_ID}${suffix}`)
      writeFileSync(path, readFileSync(path, 'utf8').replace(original.digest, replacement.digest))
    }
    expect(() => loadPersistenceHistory(root)).not.toThrow()
    expect(() => verifyPersistenceChanges(root, current)).toThrow(`finalized acknowledgement ${FINALIZED_ID} was removed or changed`)
    const before = contents(root)
    expect(() => runPersistenceChanges(['--record', '2026-09-20-later'], root, () => inventory({ value: 'string' }, 6)))
      .toThrow('finalized acknowledgement')
    expect(contents(root)).toEqual(before)
  })

  it.each(['missing checkpoint', 'missing status', 'unpaired status', 'duplicate status', 'invalid checkpoint', 'incomplete roots', 'future checkpoint'] as const)
  ('rejects %s instead of silently disabling finalization', (kind) => {
    const root = fixture()
    finalize(root)
    const checkpoint = join(root, 'docs/persistence-changes/finalized/v4.json')
    const status = join(root, 'docs/session-format-status.md')
    if (kind === 'missing checkpoint') rmSync(checkpoint)
    else if (kind === 'missing status') {
      rmSync(status)
      rmSync(join(root, 'docs/session-format-status.zh.md'))
    } else if (kind === 'unpaired status') writeFileSync(status, readFileSync(status, 'utf8').replace(': 4', ': 5'))
    else if (kind === 'duplicate status') writeFileSync(status, readFileSync(status, 'utf8').repeat(2))
    else if (kind === 'future checkpoint') writeFileSync(join(root, 'docs/persistence-changes/finalized/v5.json'), readFileSync(checkpoint))
    else {
      const data = JSON.parse(readFileSync(checkpoint, 'utf8')) as Record<string, unknown>
      if (kind === 'invalid checkpoint') data.schemaVersion = 2
      else data.roots = {}
      writeFileSync(checkpoint, JSON.stringify(data))
    }
    const before = contents(root)
    expect(() => runPersistenceChanges(['--check'], root, () => inventory({ value: 'number' }, 4))).toThrow(/finaliz|checkpoint/u)
    expect(() => runPersistenceChanges(['--record', FUTURE_ID], root, () => inventory({ value: 'boolean' }, 5)))
      .toThrow(/finaliz|checkpoint/u)
    expect(contents(root)).toEqual(before)
  })

  it('keeps older fixture roots valid when neither finalization status nor checkpoints exist', () => {
    const root = fixture()
    baseline(root)
    expect(loadPersistenceFinalization(root, loadPersistenceHistory(root))).toBeUndefined()
  })
})
