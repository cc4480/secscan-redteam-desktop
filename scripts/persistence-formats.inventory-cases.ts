/** Inventory validation and generated format facts: type coverage, schema links, and the refresh path. */

import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPersistenceFormats, runPersistenceFormats } from './persistence-formats.ts'
import { canonicalizeSchema, schemaDigest } from './persistence-schema-model.ts'
import {
  completeInventory, edit, fixture, inventory, prepareFacts, replaceSnapshot, rootSchema, saveReference, schemaPath, write,
} from './persistence-formats.fixtures-cases.ts'

describe('complete persistence format references', () => {
  it.each(['missing', 'duplicate', 'extra'])('rejects %s reachable type coverage', (variant) => {
    const root = fixture()
    const original = inventory(1)
    const extraSchema = canonicalizeSchema([{ kind: 'literal', value: 'unreferenced' }], 0)
    const types = variant === 'missing' ? original.types.slice(1)
      : variant === 'duplicate' ? [...original.types, original.types[0]!]
        : [...original.types, { schema: extraSchema, digest: schemaDigest(extraSchema), names: [], sources: [] }]
    replaceSnapshot(root, 1, 3, { ...original, types })
    expect(() => loadPersistenceFormats(root)).toThrow(variant === 'missing' ? 'cover every reachable type' : variant === 'duplicate' ? 'duplicate schema type' : 'unreferenced schema type')
  })

  it('permits extractor-retained unreachable types only in the current inventory', () => {
    const root = fixture()
    const original = inventory(3)
    const schema = canonicalizeSchema([{ kind: 'literal', value: false }], 0)
    replaceSnapshot(root, 3, 3, {
      ...original, types: [...original.types, { schema, digest: schemaDigest(schema), names: [], sources: [] }],
    })
    expect(loadPersistenceFormats(root).entries).toHaveLength(4)
  })

  it.each(['duplicate-root', 'invalid-digest', 'invalid-graph', 'unexpected-field'])('rejects malformed schema inventory: %s', (variant) => {
    const root = fixture()
    const original = inventory(1)
    const first = original.roots[0]!
    const changed = variant === 'duplicate-root' ? { ...original, roots: [...original.roots, first] }
      : variant === 'invalid-digest' ? { ...original, roots: [{ ...first, digest: '0'.repeat(64) }, ...original.roots.slice(1)] }
        : variant === 'invalid-graph' ? { ...original, roots: [{ ...first, schema: { root: 0, nodes: [{ kind: 'array', element: 99 }] } }, ...original.roots.slice(1)] }
          : { ...original, extra: true }
    write(root, schemaPath(1, 3), JSON.stringify(changed))
    expect(() => loadPersistenceFormats(root)).toThrow(variant === 'duplicate-root' ? 'duplicate schema root' : variant === 'invalid-digest' ? 'schema digest mismatch' : variant === 'invalid-graph' ? 'unknown schema node' : 'unknown field extra')
  })

  it.each(['persistence-changes/historical-formats/v1.md', 'persistence-changes/historical-formats/v1.zh.md', 'persistence-catalog.md', 'persistence-catalog.zh.md'])('requires the matching schema link in %s', (document) => {
    const root = fixture()
    const schema = document.startsWith('persistence-changes/historical-formats/') ? 'v1.schema.json' : 'persistence-schema.json'
    edit(root, `docs/${document}`, `](${schema})`, '](wrong.schema.json)')
    expect(() => loadPersistenceFormats(root)).toThrow(`missing link to ${schema}`)
  })

  it.each(['persistence-catalog.md', 'persistence-catalog.zh.md'])('rejects a placeholder current catalog in %s', (document) => {
    const root = fixture()
    write(root, `docs/${document}`, '# Placeholder\n\n[Inventory](persistence-schema.json)\n')
    expect(() => loadPersistenceFormats(root)).toThrow('missing schema index entry for SessionHeader')
  })

  it('checks generated schema regions and refreshes them without changing the recorded schemas or authored context', () => {
    const root = fixture()
    prepareFacts(root)
    const paths = [0, 1, 2, 3].map(version => schemaPath(version, 3))
    const before = paths.map(path => readFileSync(join(root, path), 'utf8'))
    expect(() => runPersistenceFormats([], root)).toThrow('Stale persistence format facts')
    expect(runPersistenceFormats(['--write'], root)).toContain('Refreshed')
    expect(runPersistenceFormats([], root)).toBe('Persistence formats: v0 through v3 verified (4 complete references).')
    expect(paths.map(path => readFileSync(join(root, path), 'utf8'))).toEqual(before)
    const index = readFileSync(join(root, 'docs/persistence-changes/historical-formats/README.md'), 'utf8')
    expect(index).toContain('Authored context.')
    expect(index).toContain('[V1](v1.md) | [JSON](v1.schema.json)')
    expect(index).toContain('[Current catalog](../../persistence-catalog.md) | [JSON](../../persistence-schema.json)')
    const translatedIndex = readFileSync(join(root, 'docs/persistence-changes/historical-formats/README.zh.md'), 'utf8')
    expect(translatedIndex).toContain('[V1](v1.zh.md) | [JSON](v1.schema.json)')
    expect(translatedIndex).toContain('[当前目录](../../persistence-catalog.zh.md) | [JSON](../../persistence-schema.json)')
    const english = readFileSync(join(root, 'docs/persistence-changes/historical-formats/v1.md'), 'utf8')
    expect(english).toContain('pullRequest: 3349')
    const [visible, collapsed] = english.split('<details>')
    expect(visible).toContain('\n## Complete schemas\n')
    expect(visible).toContain('\n### Persistence type fingerprints\n')
    expect(collapsed).toContain('\n### Resolved persistence types\n')
    expect(collapsed).toContain('\n#### `SessionHeader`\n')
    expect(english.match(/^## /gmu)).toHaveLength(1)
    expect(english.match(/^### /gmu)).toHaveLength(2)
    expect(english.match(/^#### /gmu)).toHaveLength(inventory(1).types.length)
    edit(root, 'docs/persistence-changes/historical-formats/v1.md', '<summary>Complete resolved types</summary>', '<summary>Missing definitions</summary>')
    expect(() => runPersistenceFormats([], root)).toThrow('Stale persistence format facts')
  })

  it('renders a format index for a current version-zero writer', () => {
    const root = fixture(0)
    prepareFacts(root, 0)
    runPersistenceFormats(['--write'], root)
    expect(runPersistenceFormats([], root)).toBe('Persistence formats: v0 through v0 verified (1 complete reference).')
  })

  it.each(['missing', 'stale'])('rejects a %s format pairing record and refreshes it with --write', (variant) => {
    const root = fixture()
    prepareFacts(root)
    runPersistenceFormats(['--write'], root)
    const sidecar = 'docs/persistence-changes/historical-formats/v1.i18n.yaml'
    if (variant === 'missing') rmSync(join(root, sidecar))
    else write(root, sidecar, 'schemaVersion: 1\n')
    expect(() => runPersistenceFormats([], root)).toThrow(`Stale persistence format facts: ${sidecar}`)
    runPersistenceFormats(['--write'], root)
    expect(() => runPersistenceFormats([], root)).not.toThrow()
  })

  it('refuses to refresh facts until every format reference passes validation', () => {
    const root = fixture()
    prepareFacts(root)
    const index = readFileSync(join(root, 'docs/persistence-changes/historical-formats/README.md'), 'utf8')
    rmSync(join(root, 'docs/persistence-changes/historical-formats/v1.schema.json'))
    expect(() => runPersistenceFormats(['--write'], root)).toThrow('missing persistence format artifact')
    expect(readFileSync(join(root, 'docs/persistence-changes/historical-formats/README.md'), 'utf8')).toBe(index)
  })

  it('refuses to refresh an archive after an event and all its types are removed from its schema', () => {
    const root = fixture()
    const retained = rootSchema({ key: 'event:example/retained', kind: 'event', event: 'example/retained', surface: false }, [
      { kind: 'object', indices: [], properties: [{ name: 'type', type: 1, optional: false }] },
      { kind: 'literal', value: 'example/retained' },
    ])
    const complete = completeInventory([...inventory(1).roots, retained])
    saveReference(root, 1, 3, complete)
    prepareFacts(root)
    runPersistenceFormats(['--write'], root)
    const document = 'docs/persistence-changes/historical-formats/v1.md'
    const before = readFileSync(join(root, document), 'utf8')
    replaceSnapshot(root, 1, 3, completeInventory(complete.roots.filter(root => root.key !== 'event:example/value')))
    expect(() => runPersistenceFormats(['--write'], root)).toThrow('recorded roots do not match the complete schema inventory')
    expect(readFileSync(join(root, document), 'utf8')).toBe(before)
  })
})
