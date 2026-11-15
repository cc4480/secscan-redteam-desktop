/** Persistence changes current-tree commands: record, update, and check against a fixture tree. */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPersistenceHistory, verifyPersistenceChanges } from './persistence-changes.ts'
import {
  AUTHORED_PROSE, BASE_ID, NEXT_ID, baseline, commitCurrent, fixture, finishDocuments, inventory, jsonResult, proseFile,
  runPersistenceChanges, typeRoot,
} from './persistence-changes.spec-helpers.ts'

describe('persistence changes current-tree commands', () => {
  it('requires completed record prose, rejects stale generated output, and reports unacknowledged paths', () => {
    const root = fixture()
    const before = inventory()
    runPersistenceChanges(['--baseline', BASE_ID], root, () => before)
    expect(() => loadPersistenceHistory(root)).toThrow('complete compatibility')
    finishDocuments(root, BASE_ID)
    rmSync(join(root, 'docs/persistence-schema.json'))
    expect(() => verifyPersistenceChanges(root, before)).toThrow('is missing')
    commitCurrent(root, before)
    const after = inventory({ value: 'string', 'label?': 'string' })
    expect(() => verifyPersistenceChanges(root, after)).toThrow('is stale')
    commitCurrent(root, after)
    expect(() => verifyPersistenceChanges(root, after)).toThrow('event:example/value.data.label: optional property added (same-version allowed)')
    runPersistenceChanges(['--record', NEXT_ID, '--decision', 'same-version'], root, () => after)
    finishDocuments(root, NEXT_ID)
    expect(runPersistenceChanges([], root, () => after)).toContain('4 roots match 2 history records')
    expect(() => runPersistenceChanges(['--baseline', '2026-09-11-reset'], root, () => after)).toThrow('cannot reset history')
    expect(() => runPersistenceChanges(['--record', '2026-09-11-empty', '--decision', 'same-version'], root, () => after)).toThrow('no persistence type changes')
  })

  it('rejects changed bilingual machine declarations and unreferenced snapshots', () => {
    const root = fixture()
    baseline(root)
    const chinese = join(root, 'docs/persistence-changes', `${BASE_ID}.zh.md`)
    const original = readFileSync(chinese, 'utf8')
    writeFileSync(chinese, original.replace('baseline: true', 'baseline: false'))
    expect(() => loadPersistenceHistory(root)).toThrow('bilingual machine records differ')
    writeFileSync(chinese, original)
    writeFileSync(join(root, 'docs/persistence-changes/2026-09-11-orphan.schema.json'), '{}\n')
    expect(() => loadPersistenceHistory(root)).toThrow('unreferenced')
  })

  it('excludes nested historical format documents and schemas from acknowledgements', () => {
    const root = fixture()
    baseline(root)
    const directory = join(root, 'docs/persistence-changes/historical-formats')
    mkdirSync(directory)
    writeFileSync(join(directory, 'v0.md'), '---\nkind: persistence-format\n---\n')
    writeFileSync(join(directory, 'v0.schema.json'), '{}\n')
    expect(loadPersistenceHistory(root).entries.map(entry => entry.record.id)).toEqual([BASE_ID])
  })

  it.each([
    ['optional field', inventory({ value: 'string', 'label?': 'string' })],
    ['required-to-optional field', inventory({ 'value?': 'string' })],
    ['ordinary event addition', { ...inventory(), roots: [...inventory().roots, typeRoot('event:example/added', { count: 'number' })] }],
  ] as const)('infers same-version for %s', (_name, after) => {
    const root = fixture()
    baseline(root)
    runPersistenceChanges(['--record', NEXT_ID, '--prose', proseFile(root)], root, () => after)
    const changes = loadPersistenceHistory(root).entries.find(entry => entry.record.id === NEXT_ID)?.record.changes
    expect(changes?.length).toBeGreaterThan(0)
    expect(changes?.every(change => change.decision === 'same-version')).toBe(true)
    verifyPersistenceChanges(root, after)
  })

  it('infers a version bump when the source includes its own increasing header version', () => {
    const root = fixture()
    baseline(root)
    const after = inventory({ value: 'number' }, 4)
    runPersistenceChanges(['--record', NEXT_ID, '--prose', proseFile(root)], root, () => after)
    const changes = loadPersistenceHistory(root).entries.find(entry => entry.record.id === NEXT_ID)?.record.changes
    expect(changes?.map(change => change.root).sort()).toEqual(['SessionHeader', 'event:example/value'])
    expect(changes?.every(change => change.decision === 'version-bump')).toBe(true)
    verifyPersistenceChanges(root, after)
  })

  it('rejects inferred bumps without a header transition and explicit incorrect assertions before writing', () => {
    const root = fixture()
    baseline(root)
    const prose = proseFile(root)
    const directory = join(root, 'docs/persistence-changes')
    const files = readdirSync(directory).sort()
    const inventoryPath = join(root, 'docs/persistence-schema.json')
    const before = readFileSync(inventoryPath, 'utf8')
    for (const [args, code] of [
      [[], 'version-transition-required'],
      [['--decision', 'same-version'], 'version-bump-required'],
    ] as const) {
      const result = jsonResult(runPersistenceChanges(['--record', NEXT_ID, '--prose', prose, '--json', ...args], root,
        () => inventory({ value: 'number' })))
      expect(result).toMatchObject({ ok: false, code, files: [], changes: [expect.objectContaining({ requiresVersionBump: true })] })
      expect(readFileSync(inventoryPath, 'utf8')).toBe(before)
      expect(readdirSync(directory).sort()).toEqual(files)
    }
  })

  it('authors a complete pair from explicit prose and reports source changes even when generated artifacts are stale', () => {
    const root = fixture()
    baseline(root)
    const after = inventory({ value: 'string', 'label?': 'string' })
    const pending = jsonResult(runPersistenceChanges(['--check', '--json'], root, () => after))
    expect(pending).toMatchObject({ ok: false, operation: 'check', code: 'stale-artifacts',
      roots: [{ root: 'event:example/value', kind: 'event', before: inventory().roots[2]?.digest, after: after.roots[2]?.digest }], changes: [
        { root: 'event:example/value', path: 'event:example/value.data.label', kind: 'optional-property-added', requiresVersionBump: false },
      ] })
    const written = jsonResult(runPersistenceChanges(['--record', NEXT_ID, '--decision', 'same-version', '--prose', proseFile(root), '--json'], root, () => after))
    expect(written).toMatchObject({ ok: true, operation: 'record', recordId: NEXT_ID })
    expect(written.files).toEqual([
      'docs/persistence-schema.json', `docs/persistence-changes/${NEXT_ID}.md`, `docs/persistence-changes/${NEXT_ID}.zh.md`,
      `docs/persistence-changes/${NEXT_ID}.i18n.yaml`, `docs/persistence-changes/${NEXT_ID}.schema.json`,
    ])
    expect(written).toMatchObject({ roots: [{ root: 'event:example/value', kind: 'event',
      before: inventory().roots[2]?.digest, after: after.roots[2]?.digest }] })
    expect(readFileSync(join(root, `docs/persistence-changes/${NEXT_ID}.md`), 'utf8')).toContain(AUTHORED_PROSE.en.compatibility)
    expect(jsonResult(runPersistenceChanges(['--check', '--json'], root, () => after)).ok).toBe(true)
  })

  it('refreshes only a terminal acknowledgement while preserving its authored prose and predecessor', () => {
    const root = fixture()
    baseline(root)
    const after = inventory({ value: 'string', 'label?': 'string' })
    const prose = proseFile(root)
    runPersistenceChanges(['--record', NEXT_ID, '--decision', 'same-version', '--prose', prose], root, () => after)
    const path = join(root, `docs/persistence-changes/${NEXT_ID}.md`)
    const beforeText = readFileSync(path, 'utf8')
    const refreshed = inventory({ value: 'string', 'label?': 'string', 'extra?': 'number' })
    runPersistenceChanges(['--update', NEXT_ID], root, () => refreshed)
    const stripRecord = (value: string): string => value.replace(/```yaml persistence-change[\s\S]*?```/u, '')
    expect(stripRecord(readFileSync(path, 'utf8'))).toBe(stripRecord(beforeText))
    expect(loadPersistenceHistory(root).tips.get('event:example/value')?.id).toBe(NEXT_ID)
    expect(loadPersistenceHistory(root).entries.find(entry => entry.record.id === NEXT_ID)?.record.changes[0]?.previous).toBe(BASE_ID)
    expect(jsonResult(runPersistenceChanges(['--check', '--json'], root, () => refreshed)).ok).toBe(true)
    const final = inventory({ value: 'string', 'label?': 'string', 'extra?': 'number', 'last?': 'boolean' })
    runPersistenceChanges(['--record', '2026-09-11-successor', '--decision', 'same-version', '--prose', prose], root, () => final)
    expect(() => runPersistenceChanges(['--update', NEXT_ID, '--decision', 'same-version'], root, () => final)).toThrow('with successors')
    expect(() => runPersistenceChanges(['--update', BASE_ID, '--decision', 'same-version'], root, () => final)).toThrow('cannot update the persistence baseline')
  })

  it('completes a scaffold through update and rejects invalid prose or decisions before changing files', () => {
    const root = fixture()
    baseline(root)
    const after = inventory({ value: 'string', 'label?': 'string' })
    runPersistenceChanges(['--record', NEXT_ID, '--decision', 'same-version'], root, () => after)
    const prose = proseFile(root)
    runPersistenceChanges(['--update', NEXT_ID, '--decision', 'same-version', '--prose', prose], root, () => after)
    expect(runPersistenceChanges(['--check'], root, () => after)).toContain('roots match')
    expect(readFileSync(join(root, `docs/persistence-changes/${NEXT_ID}.md`), 'utf8')).not.toContain('TODO:')
    const pairedPaths = ['.md', '.zh.md', '.i18n.yaml'].map(suffix => join(root, `docs/persistence-changes/${NEXT_ID}${suffix}`))
    const completed = pairedPaths.map(path => readFileSync(path, 'utf8'))
    runPersistenceChanges(['--update', NEXT_ID, '--decision', 'same-version', '--prose', prose], root, () => after)
    expect(pairedPaths.map(path => readFileSync(path, 'utf8'))).toEqual(completed)
    const path = join(root, `docs/persistence-changes/${NEXT_ID}.md`)
    const before = readFileSync(path, 'utf8')
    const invalid = inventory({ value: 'number' })
    const result = jsonResult(runPersistenceChanges(['--update', NEXT_ID, '--decision', 'same-version', '--json'], root, () => invalid))
    expect(result).toMatchObject({ ok: false, code: 'version-bump-required', changes: [expect.objectContaining({ kind: 'type-changed', requiresVersionBump: true })] })
    expect(readFileSync(path, 'utf8')).toBe(before)
    for (const value of [
      { ...AUTHORED_PROSE, extra: 'unsupported' },
      { ...AUTHORED_PROSE, en: { ...AUTHORED_PROSE.en, compatibility: '   ' } },
      { ...AUTHORED_PROSE, zh: { ...AUTHORED_PROSE.zh, verification: 'TODO: record validation evidence.' } },
      { ...AUTHORED_PROSE, zh: { ...AUTHORED_PROSE.zh, verification: '```text\nUnpaired code.\n```' } },
    ]) {
      writeFileSync(prose, JSON.stringify(value))
      expect(() => runPersistenceChanges(['--update', NEXT_ID, '--decision', 'same-version', '--prose', prose], root, () => after)).toThrow()
      expect(readFileSync(path, 'utf8')).toBe(before)
    }
  })
})
