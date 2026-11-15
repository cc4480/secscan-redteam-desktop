/** The release-facts cases: the generated index and record blocks stay in step with the archive. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { directoryBytes, fixture, inventory, replaceSnapshot, rootSchema, saveRecord, TAGS } from './persistence-releases.harness-cases.ts'
import { loadPersistenceReleases, runPersistenceReleases } from './persistence-releases.ts'

describe('release facts', () => {
  it('refreshes complete-state counts and singular wording while preserving authored text, declarations, and snapshots', () => {
    const data = fixture()
    const before = directoryBytes(data.directory)
    expect(() => runPersistenceReleases([], data.root)).toThrow('Stale persistence release facts')
    expect(directoryBytes(data.directory)).toEqual(before)
    expect(runPersistenceReleases(['--write'], data.root)).toContain('3 records, 2 adjacent transitions verified')
    expect(runPersistenceReleases([], data.root)).toContain('3 records, 2 adjacent transitions verified')
    const after = directoryBytes(data.directory)
    expect(after['README.md']).toContain(`| [${TAGS[1]}](${TAGS[1]}.md) | 2026-09-01 | 0 | 4 / 7 | 1 |`)
    expect(after[TAGS[1] + '.md']).toContain('4 roots / 7 types')
    expect(after[TAGS[1] + '.md']).toContain('Detected 1 changed root and 1 structural difference.')
    expect(after[TAGS[1] + '.md']).toContain('| `event:example/value.data` | `type-changed` | `version-bump` |')
    for (const [name, source] of Object.entries(before)) {
      if (name.endsWith('.json')) expect(after[name]).toBe(source)
      if (name.endsWith('.md')) {
        expect(after[name]).toContain(name.startsWith('README') ? 'Authored introduction.' : 'Authored summary and evidence.')
        if (!name.startsWith('README')) expect(after[name]?.match(/```yaml persistence-release\n[\s\S]*?```/u)?.[0])
          .toBe(source.match(/```yaml persistence-release\n[\s\S]*?```/u)?.[0])
      }
    }
    expect(after[TAGS[1] + '.i18n.yaml']).not.toBe(before[TAGS[1] + '.i18n.yaml'])
    expect(runPersistenceReleases(['--write'], data.root)).toContain('Refreshed 0 files.')
    expect(directoryBytes(data.directory)).toEqual(after)
  })

  it.each([
    ['tag label', `[${TAGS[0]}]`, '[wrong-tag]'],
    ['date', '| 2026-09-01 |', '| 1999-01-01 |'],
    ['writer', '| 0 | 4 / 7 |', '| 9 | 4 / 7 |'],
    ['roots', '| 4 / 7 |', '| 99 / 7 |'],
    ['types', '| 4 / 7 |', '| 4 / 99 |'],
    ['changes', '| 4 / 7 | 4 |', '| 4 / 7 | 99 |'],
  ])('rejects stale index %s', (_label, original, replacement) => {
    const data = fixture()
    runPersistenceReleases(['--write'], data.root)
    const path = join(data.directory, 'README.md')
    const source = readFileSync(path, 'utf8')
    expect(source).toContain(original)
    writeFileSync(path, source.replace(original, replacement))
    expect(() => runPersistenceReleases([], data.root)).toThrow('Stale persistence release facts')
  })

  it.each([
    ['inventory', '4 roots / 7 types', '4 roots / 999 types'],
    ['root count', '1 changed root', '9 changed roots'],
    ['difference count', '1 structural difference', '9 structural differences'],
    ['path', '`event:example/value.data`', '`event:example/value.wrong`'],
    ['kind', '`type-changed`', '`optional-property-added`'],
    ['minimum', '`version-bump`', '`same-version`'],
  ])('rejects stale record %s', (_label, original, replacement) => {
    const data = fixture()
    runPersistenceReleases(['--write'], data.root)
    const path = join(data.directory, TAGS[1] + '.md')
    const source = readFileSync(path, 'utf8')
    expect(source).toContain(original)
    writeFileSync(path, source.replace(original, replacement))
    expect(() => runPersistenceReleases([], data.root)).toThrow('Stale persistence release facts')
  })

  it('checks Chinese facts too and allows authored prose outside generated regions to change', () => {
    const data = fixture()
    runPersistenceReleases(['--write'], data.root)
    const path = join(data.directory, TAGS[1] + '.zh.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace('Authored summary and evidence.', 'Revised authored explanation.'))
    expect(() => runPersistenceReleases([], data.root)).not.toThrow()
    writeFileSync(path, readFileSync(path, 'utf8').replace('4 个根类型 / 7 种类型', '4 个根类型 / 999 种类型'))
    expect(() => runPersistenceReleases([], data.root)).toThrow('Stale persistence release facts')
  })

  it('does not write anything when machine data is corrupt or a later pair cannot be rendered', () => {
    const data = fixture()
    const snapshotPath = join(data.directory, TAGS[2] + '.schema.json')
    const snapshot = readFileSync(snapshotPath, 'utf8')
    writeFileSync(snapshotPath, snapshot.replace('"formatVersion":1', '"formatVersion":3'))
    const corrupt = directoryBytes(data.directory)
    expect(() => runPersistenceReleases(['--write'], data.root)).toThrow('normalization version')
    expect(directoryBytes(data.directory)).toEqual(corrupt)
    writeFileSync(snapshotPath, snapshot)
    const path = join(data.directory, TAGS[2] + '.zh.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace('<!-- persistence-release-changes:end -->', ''))
    const missingMarker = directoryBytes(data.directory)
    expect(() => runPersistenceReleases(['--write'], data.root)).toThrow('expected one changes factual block')
    expect(directoryBytes(data.directory)).toEqual(missingMarker)
  })

  it('accepts matching literal writer versions and rejects a missing reconstructed header', () => {
    const data = fixture()
    const header = rootSchema('SessionHeader', [
      { kind: 'object', indices: [], properties: [{ name: 'version', type: 1, optional: false }] }, { kind: 'literal', value: 0 },
    ])
    for (const roots of [data.snapshots[0]!.roots.map(root => root.key === header.key ? header : root),
      data.snapshots[0]!.roots.filter(root => root.key !== header.key)]) {
      const snapshot = inventory(roots)
      replaceSnapshot(data, 0, snapshot)
      saveRecord(data.directory, { ...data.records[0]!,
        changes: roots.map(root => ({ root: root.key, before: null, after: root.digest })),
      })
      if (roots.some(root => root.key === header.key)) expect(() => loadPersistenceReleases(data.root)).not.toThrow()
      else expect(() => loadPersistenceReleases(data.root)).toThrow('reconstructed state is missing SessionHeader')
    }
  })
})
