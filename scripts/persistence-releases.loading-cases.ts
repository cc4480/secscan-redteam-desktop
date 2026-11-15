/** The archive-loading cases: which recorded transitions a release tree may and may not reconstruct. */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePersistenceSnapshot } from './persistence-changes.ts'
import { event, fixture, inventory, replaceSnapshot, rootSchema, saveRecord, TAGS } from './persistence-releases.harness-cases.ts'
import { loadPersistenceReleases } from './persistence-releases.ts'
import type { PersistenceReleaseRecord } from './persistence-releases.ts'

describe('pinned persistence releases', () => {
  it.each(['.md', '.zh.md'])('rejects historical source coordinates in %s records', (suffix) => {
    const data = fixture()
    const path = join(data.directory, TAGS[0] + suffix)
    const original = readFileSync(path, 'utf8')
    for (const position of [':36', ':36:2', '#L36', '#L36-L38']) {
      writeFileSync(path, original + `\nSource: \`packages/core/session/src/types.ts${position}\`.\n`)
      expect(() => loadPersistenceReleases(data.root)).toThrow('historical source references must omit line numbers')
    }
    writeFileSync(path, original + '\nSource: `packages/core/session/src/types.ts`.\n')
    expect(loadPersistenceReleases(data.root).entries).toHaveLength(3)
  })

  it('rejects historical source coordinates in release schema metadata', () => {
    const data = fixture()
    const snapshot = data.snapshots[0]!
    replaceSnapshot(data, 0, { ...snapshot, types: snapshot.types.map((type, index) => index === 0
      ? { ...type, sources: ['packages/core/session/src/types.ts:36'] } : type) })
    expect(() => loadPersistenceReleases(data.root)).toThrow('historical schema sources must omit line numbers')
  })

  it('reconstructs breaking version-zero changes and unchanged releases from a tree without Git or package sources', () => {
    const data = fixture()
    const archive = loadPersistenceReleases(data.root)
    expect(archive.entries).toHaveLength(3)
    expect(archive.entries[0]!.roots.get('event:example/value')!.digest).toBe(event('string').digest)
    expect(archive.entries[1]!.roots.get('event:example/value')!.digest).toBe(event('number').digest)
    expect(archive.entries[1]!.differences).toEqual([expect.objectContaining({ root: 'event:example/value', kind: 'type-changed', requiresVersionBump: true })])
    expect(archive.entries[2]!.roots).toEqual(archive.entries[1]!.roots)
    expect(archive.entries[2]!.differences).toEqual([])
    expect(() => parsePersistenceSnapshot(data.snapshots[1])).toThrow('surface metadata')
  })

  it.each(['.md', '.zh.md', '.i18n.yaml', '.schema.json'])('rejects a missing manifest release companion %s', (suffix) => {
    const data = fixture()
    rmSync(join(data.directory, TAGS[1] + suffix))
    expect(() => loadPersistenceReleases(data.root)).toThrow('missing release artifact')
  })

  it.each(['README.md', 'README.zh.md', 'README.i18n.yaml'])('requires the fixed archive companion %s', (name) => {
    const data = fixture()
    rmSync(join(data.directory, name))
    expect(() => loadPersistenceReleases(data.root)).toThrow(`missing release artifact ${name}`)
  })

  it.each(['orphan.md', 'orphan.schema.json', 'orphan.zh.md', 'orphan.i18n.yaml'])('rejects an unreferenced archive file %s', (filename) => {
    const data = fixture()
    writeFileSync(join(data.directory, filename), '{}')
    expect(() => loadPersistenceReleases(data.root)).toThrow('unreferenced persistence release artifact')
  })

  it('rejects missing, duplicated, and misordered manifest entries', () => {
    const data = fixture()
    for (const releases of [
      data.manifest.releases.slice(1), [data.manifest.releases[0], ...data.manifest.releases], [...data.manifest.releases].reverse(),
    ]) {
      writeFileSync(join(data.directory, 'manifest.json'), JSON.stringify({ ...data.manifest, releases }))
      expect(() => loadPersistenceReleases(data.root)).toThrow(/unreferenced|semantic-version order/u)
    }
  })

  it('rejects malformed manifest identities and version metadata', () => {
    const data = fixture()
    for (const changes of [
      { tag: 'dsh-v0.1.0-beta.1' }, { sourceDate: '2026-09-01' },
      { publishedAt: 'yesterday' }, { sessionFormatVersion: -1 }, { sessionFormatVersion: 1.5 },
    ]) {
      writeFileSync(join(data.directory, 'manifest.json'), JSON.stringify({ ...data.manifest,
        releases: data.manifest.releases.map((release, index) => index === 0 ? { ...release, ...changes } : release),
      }))
      expect(() => loadPersistenceReleases(data.root)).toThrow(/invalid value|nonnegative integer/u)
    }
    for (const changes of [{ schemaVersion: 2 }, { capturedAt: '2026-02-30' }, { releases: [] }]) {
      writeFileSync(join(data.directory, 'manifest.json'), JSON.stringify({ ...data.manifest, ...changes }))
      expect(() => loadPersistenceReleases(data.root)).toThrow(/schema version|capture date|must not be empty/u)
    }
  })

  it('rejects removed manifest and record fields as unknown metadata', () => {
    const data = fixture()
    writeFileSync(join(data.directory, 'manifest.json'), JSON.stringify({ ...data.manifest, repository: 'example' }))
    expect(() => loadPersistenceReleases(data.root)).toThrow('unknown field repository')
    for (const field of ['commit', 'committedAt', 'sqliteSchemaVersion']) {
      writeFileSync(join(data.directory, 'manifest.json'), JSON.stringify({ ...data.manifest,
        releases: data.manifest.releases.map((release, index) => index === 0 ? { ...release, [field]: null } : release),
      }))
      expect(() => loadPersistenceReleases(data.root)).toThrow(`unknown field ${field}`)
    }
    writeFileSync(join(data.directory, 'manifest.json'), JSON.stringify(data.manifest))
    for (const field of ['commit', 'sqliteSchemaVersion']) {
      saveRecord(data.directory, { ...data.records[1]!, [field]: null })
      expect(() => loadPersistenceReleases(data.root)).toThrow(`unknown field ${field}`)
    }
  })

  it('rejects wrong predecessor, format version, schema version, and duplicate roots', () => {
    const data = fixture()
    const original = data.records[1]!
    for (const changed of [
      { ...original, previous: null },
      { ...original, sessionFormatVersion: 2 }, { ...original, schemaVersion: 2 },
      { ...original, changes: [...original.changes, ...original.changes] },
    ]) {
      saveRecord(data.directory, changed as PersistenceReleaseRecord)
      expect(() => loadPersistenceReleases(data.root)).toThrow(/predecessor|match manifest|schema version|duplicate change/u)
    }
  })

  it('rejects before and after digest mismatches', () => {
    const data = fixture()
    const original = data.records[1]!
    for (const field of ['before', 'after']) {
      saveRecord(data.directory, { ...original, changes: original.changes.map(change => ({ ...change, [field]: 'f'.repeat(64) })) })
      expect(() => loadPersistenceReleases(data.root)).toThrow(`${field} digest mismatch`)
    }
  })

  it('rejects an unchanged transition and an unacknowledged after root', () => {
    const data = fixture()
    saveRecord(data.directory, { ...data.records[2]!, changes: [{ root: 'event:example/value', before: event('number').digest, after: event('number').digest }] })
    replaceSnapshot(data, 2, data.snapshots[1]!)
    expect(() => loadPersistenceReleases(data.root)).toThrow('unchanged transition')
    saveRecord(data.directory, data.records[2]!)
    expect(() => loadPersistenceReleases(data.root)).toThrow('snapshot roots')
  })

  it('reconstructs deletions without requiring an after schema or a historical version increase', () => {
    const data = fixture()
    saveRecord(data.directory, { ...data.records[2]!, changes: [{ root: 'event:example/value', before: event('number').digest, after: null }] })
    const result = loadPersistenceReleases(data.root)
    expect(result.entries[2]!.roots.has('event:example/value')).toBe(false)
    expect(result.entries[2]!.differences).toEqual([expect.objectContaining({ kind: 'root-removed', requiresVersionBump: true })])
  })

  it('rejects missing, duplicate, and unreferenced reachable types', () => {
    const data = fixture()
    const snapshot = data.snapshots[1]!
    const unrelated = inventory([rootSchema('SessionHeader', [{ kind: 'primitive', type: 'boolean' }])]).types[0]!
    for (const types of [snapshot.types.slice(1), [...snapshot.types, snapshot.types[0]!], [...snapshot.types, unrelated]]) {
      replaceSnapshot(data, 1, { ...snapshot, types })
      expect(() => loadPersistenceReleases(data.root)).toThrow(/every reachable type|duplicate schema type|unreferenced schema type/u)
    }
  })

  it('rejects mismatched translations, duplicate blocks, and the wrong document kind', () => {
    const data = fixture()
    const path = join(data.directory, TAGS[1] + '.zh.md')
    const source = readFileSync(path, 'utf8')
    for (const changed of [
      source.replace('schemaVersion: 1', 'schemaVersion: 2'), source + source,
      source.replace('kind: persistence-release', 'kind: persistence-change'),
    ]) {
      writeFileSync(path, changed)
      expect(() => loadPersistenceReleases(data.root)).toThrow(/bilingual machine|exactly one|frontmatter kind/u)
    }
  })

  it('matches literal header versions when a historical declaration pins one', () => {
    const data = fixture()
    const header = rootSchema('SessionHeader', [
      { kind: 'object', indices: [], properties: [{ name: 'version', type: 1, optional: false }] }, { kind: 'literal', value: 9 },
    ])
    const snapshot = inventory(data.snapshots[0]!.roots.map(root => root.key === header.key ? header : root))
    replaceSnapshot(data, 0, snapshot)
    saveRecord(data.directory, { ...data.records[0]!,
      changes: snapshot.roots.map(root => ({ root: root.key, before: null, after: root.digest })),
    })
    expect(() => loadPersistenceReleases(data.root)).toThrow('SessionHeader.version')
  })
})
