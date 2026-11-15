/** Reference documents, pairing records, and recorded roots: what a complete format reference must contain. */

import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dump } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { loadPersistenceFormats } from './persistence-formats.ts'
import {
  completeInventory, edit, editPair, fixture, header, inventory, replaceSnapshot, rootSchema, saveReference, write,
} from './persistence-formats.fixtures-cases.ts'

describe('complete persistence format references', () => {
  it.each(['.md', '.zh.md'])('rejects source coordinates in authored format evidence in %s', (suffix) => {
    const root = fixture()
    const path = `docs/persistence-changes/historical-formats/v1${suffix}`
    const original = readFileSync(join(root, path), 'utf8')
    for (const position of [':36', ':36:2', '#L36', '#L36-L38']) {
      write(root, path, original + `\nSource: \`packages/core/session/src/types.ts${position}\`.\n`)
      expect(() => loadPersistenceFormats(root)).toThrow('historical source references must omit line numbers')
    }
    write(root, path, original + '\nSource: `packages/core/session/src/types.ts`.\n')
    expect(loadPersistenceFormats(root).entries).toHaveLength(4)
  })

  it('loads a contiguous archive and the current catalog without Git or historical package sources', () => {
    const formats = loadPersistenceFormats(fixture())
    expect(formats.currentVersion).toBe(3)
    expect(formats.entries.map(entry => entry.version)).toEqual([0, 1, 2, 3])
    expect(formats.entries[0]?.source).toEqual({ tag: 'dsh-v0.1.0-rc.5' })
    expect(formats.entries[1]?.source).toEqual({ pullRequest: 3349 })
    expect(formats.entries[3]).toMatchObject({ document: 'docs/persistence-catalog.md', schemaPath: 'docs/persistence-schema.json' })
    expect(formats.entries[3]?.source).toBeUndefined()
  })

  it('accepts a version-zero writer without a historical directory', () => {
    const root = fixture(0)
    rmSync(join(root, 'docs/persistence-changes/historical-formats'), { recursive: true })
    expect(loadPersistenceFormats(root).entries).toHaveLength(1)
  })

  it.each(['.md', '.zh.md', '.schema.json'])('requires every historical companion %s', (suffix) => {
    const root = fixture()
    rmSync(join(root, `docs/persistence-changes/historical-formats/v1${suffix}`))
    expect(() => loadPersistenceFormats(root)).toThrow(`missing persistence format artifact v1${suffix}`)
  })

  it('rejects a gap even when all remaining versions have complete companions', () => {
    const root = fixture()
    for (const suffix of ['.md', '.zh.md', '.schema.json']) rmSync(join(root, `docs/persistence-changes/historical-formats/v1${suffix}`))
    expect(() => loadPersistenceFormats(root)).toThrow('v1: missing persistence format artifact')
  })

  it.each(['persistence-catalog.md', 'persistence-catalog.zh.md', 'persistence-schema.json'])('requires the current reference artifact %s', (filename) => {
    const root = fixture()
    rmSync(join(root, `docs/${filename}`))
    expect(() => loadPersistenceFormats(root)).toThrow(`missing persistence format artifact docs/${filename}`)
  })

  it('requires a formerly current archive when the writer advances', () => {
    const root = fixture()
    write(root, 'packages/core/session/src/types.ts', 'export const SESSION_FORMAT_VERSION = 4 as const\n')
    saveReference(root, 4, 4)
    expect(() => loadPersistenceFormats(root)).toThrow('v3: missing persistence format artifact')
    saveReference(root, 3, 4)
    expect(loadPersistenceFormats(root).entries.map(entry => entry.version)).toEqual([0, 1, 2, 3, 4])
  })

  it.each(['v3.md', 'v9.schema.json', 'v01.md', 'v-1.md', 'v2.schema.yaml', 'v3.i18n.yaml'])('rejects unexpected or duplicate format filename %s', (filename) => {
    const root = fixture()
    write(root, `docs/persistence-changes/historical-formats/${filename}`, '{}')
    expect(() => loadPersistenceFormats(root)).toThrow(`unexpected persistence format artifact ${filename}`)
  })

  it('rejects bilingual declarations that differ', () => {
    const root = fixture()
    edit(root, 'docs/persistence-changes/historical-formats/v1.zh.md', 'pullRequest: 3349', 'pullRequest: 3397')
    expect(() => loadPersistenceFormats(root)).toThrow('bilingual machine records differ')
  })

  it.each([
    ['kind: persistence-format', 'kind: persistence-release', 'frontmatter kind'],
    ['sessionFormatVersion: 1', 'sessionFormatVersion: 0', 'must match its filename'],
    ['schemaVersion: 1', 'schemaVersion: 2', 'unsupported persistence format record schema version'],
    ['pullRequest: 3349', 'pullRequest: 0', 'positive integer'],
    ['pullRequest: 3349', 'pullRequest: 1.5', 'positive integer'],
    ['pullRequest: 3349', 'pullRequest: 3349\n  tag: dsh-v0.1.0', 'expected fields'],
    ['pullRequest: 3349', 'other: 3349', 'expected fields'],
    ['source:\n  pullRequest: 3349', 'source: null', 'expected an object'],
    ['schemaVersion: 1', 'schemaVersion: 1\nunknown: true', 'expected fields'],
  ])('rejects inconsistent machine data: %s', (from, to, error) => {
    const root = fixture()
    editPair(root, 1, from, to)
    expect(() => loadPersistenceFormats(root)).toThrow(error)
  })

  it('rejects a source tag outside the DSH release namespace', () => {
    const root = fixture()
    editPair(root, 0, 'tag: dsh-v0.1.0-rc.5', 'tag: latest')
    expect(() => loadPersistenceFormats(root)).toThrow('invalid source tag')
  })

  it.each(['missing', 'extra', 'wrong-digest'])('rejects a %s recorded root', (variant) => {
    const root = fixture()
    const digest = inventory(1).roots[0]!.digest
    const from = variant === 'extra' ? 'roots:\n' : `  SessionHeader: ${digest}\n`
    const to = variant === 'missing' ? '' : variant === 'extra' ? `roots:\n  event:undeclared: ${'f'.repeat(64)}\n`
      : `  SessionHeader: ${'f'.repeat(64)}\n`
    editPair(root, 1, from, to)
    expect(() => loadPersistenceFormats(root)).toThrow('recorded roots do not match the complete schema inventory')
  })

  it.each(['unknown-key', 'invalid-digest', 'duplicate-key', 'not-a-mapping'])('rejects invalid recorded roots: %s', (variant) => {
    const root = fixture()
    const digest = inventory(1).roots[0]!.digest
    const from = variant === 'not-a-mapping' ? dump({ roots: Object.fromEntries(inventory(1).roots.map(root => [root.key, root.digest])) })
      : `  SessionHeader: ${digest}\n`
    const to = variant === 'unknown-key' ? `  unknown: ${digest}\n` : variant === 'invalid-digest' ? '  SessionHeader: invalid\n'
      : variant === 'duplicate-key' ? from + from : 'roots: []\n'
    editPair(root, 1, from, to)
    expect(() => loadPersistenceFormats(root)).toThrow(variant === 'duplicate-key' ? 'duplicated mapping key'
      : variant === 'not-a-mapping' ? 'roots must be a mapping' : 'invalid recorded root')
  })

  it.each(['missing', 'duplicate'])('rejects a %s machine block', (variant) => {
    const root = fixture()
    for (const suffix of ['.md', '.zh.md']) {
      const path = `docs/persistence-changes/historical-formats/v1${suffix}`
      const text = readFileSync(join(root, path), 'utf8')
      write(root, path, variant === 'missing' ? text.replace('```yaml persistence-format', '```yaml') : text + '\n```yaml persistence-format\n{}\n```\n')
    }
    expect(() => loadPersistenceFormats(root)).toThrow('expected exactly one persistence-format machine record')
  })

  it.each(['SessionHeader', 'JsonlHeaderLine', 'SessionEventEnvelope', 'event:example/value'])('rejects an inventory missing %s', (key) => {
    const root = fixture()
    replaceSnapshot(root, 1, 3, completeInventory(inventory(1).roots.filter(root => root.key !== key)))
    expect(() => loadPersistenceFormats(root)).toThrow(key.startsWith('event:') ? 'must include an event root' : `missing schema root ${key}`)
  })

  it.each([0, 1, 2, 3])('rejects a mismatched header version at v%s', (version) => {
    const root = fixture()
    replaceSnapshot(root, version, 3, completeInventory(inventory(version).roots.map(root => root.key === 'SessionHeader' ? header(root.key, version + 1) : root)))
    expect(() => loadPersistenceFormats(root)).toThrow('SessionHeader.version must match')
  })

  it('retains historical number declarations but requires the current logical header literal', () => {
    const root = fixture()
    for (const version of [0, 1, 2]) {
      saveReference(root, version, 3, completeInventory(inventory(version).roots.map(root => root.key === 'SessionHeader' ? header(root.key, 'number') : root)))
    }
    expect(loadPersistenceFormats(root).entries).toHaveLength(4)
    replaceSnapshot(root, 3, 3, completeInventory(inventory(3).roots.map(root => root.key === 'SessionHeader' ? header(root.key, 'number') : root)))
    expect(() => loadPersistenceFormats(root)).toThrow('SessionHeader.version must match the current writer version')
  })

  it.each(['SessionHeader', 'JsonlHeaderLine'])('requires a present %s version property', (key) => {
    const root = fixture()
    replaceSnapshot(root, 1, 3, completeInventory(inventory(1).roots.map(root => root.key === key ? header(key, 1, true) : root)))
    expect(() => loadPersistenceFormats(root)).toThrow(`${key}.version must match`)
  })

  it('uses historical surface rules only for historical references', () => {
    const root = fixture()
    const event = rootSchema({ key: 'event:example/value', kind: 'event', event: 'example/value', surface: true }, [
      { kind: 'object', indices: [], properties: [
        { name: 'type', type: 1, optional: false }, { name: 'surfaceOp', type: 2, optional: true },
      ] },
      { kind: 'literal', value: 'example/value' }, { kind: 'primitive', type: 'string' },
    ])
    saveReference(root, 1, 3, completeInventory(inventory(1).roots.map(root => root.kind === 'event' ? event : root)))
    expect(loadPersistenceFormats(root).entries).toHaveLength(4)
    replaceSnapshot(root, 3, 3, completeInventory(inventory(3).roots.map(root => root.kind === 'event' ? event : root)))
    expect(() => loadPersistenceFormats(root)).toThrow('surface metadata does not match its schema')
  })
})
