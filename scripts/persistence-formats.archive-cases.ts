/** Archive commands: the reachable-type projection, invalid versions, overwrite refusal, and pre-write validation. */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPersistenceFormats, runPersistenceFormats } from './persistence-formats.ts'
import { parseHistoricalPersistenceSnapshot } from './persistence-changes.ts'
import { canonicalizeSchema, schemaDigest } from './persistence-schema-model.ts'
import { edit, fixture, inventory, replaceSnapshot, saveReference, write } from './persistence-formats.fixtures-cases.ts'

describe('archive current persistence format', () => {
  it('keeps every reachable type and drops extractor-retained types and source line numbers', () => {
    const root = fixture()
    const original = inventory(3)
    const sources = [
      'packages/example/src/types.ts:12', 'packages/other/src/types.ts:8:2', 'packages/example/src/types.ts:34:5',
      'packages/plain/src/types.ts', 'packages/fragment/src/types.ts#L8', 'packages/fragment/src/types.ts#L8-L12',
    ]
    const types = original.types.map(type => ({ ...type, names: ['Example'], sources }))
    const schema = canonicalizeSchema([{ kind: 'literal', value: 'unreferenced' }], 0)
    replaceSnapshot(root, 3, 3, { ...original, types: [...types, { schema, digest: schemaDigest(schema), names: [], sources: [] }] })
    const before = readFileSync(join(root, 'docs/persistence-schema.json'), 'utf8')

    expect(runPersistenceFormats(['--archive', '3'], root)).toBe('Archived Session format v3 to docs/persistence-changes/historical-formats/v3.schema.json.')
    const serialized = readFileSync(join(root, 'docs/persistence-changes/historical-formats/v3.schema.json'), 'utf8')
    const archived = parseHistoricalPersistenceSnapshot(JSON.parse(serialized))
    expect(archived).toEqual({
      ...original,
      types: types.map(type => ({ ...type, sources: [
        'packages/example/src/types.ts', 'packages/other/src/types.ts', 'packages/plain/src/types.ts', 'packages/fragment/src/types.ts',
      ] })),
    })
    expect(serialized).toBe(JSON.stringify(archived, null, 2) + '\n')
    expect(readFileSync(join(root, 'docs/persistence-schema.json'), 'utf8')).toBe(before)
    expect(existsSync(join(root, 'docs/persistence-changes/historical-formats/v3.md'))).toBe(false)

    saveReference(root, 3, 4, archived)
    write(root, 'packages/core/session/src/types.ts', 'export const SESSION_FORMAT_VERSION = 4 as const\n')
    saveReference(root, 4, 4)
    expect(loadPersistenceFormats(root).entries[3]?.inventory).toEqual(archived)
  })

  it('creates the first archive directory and honors --root', () => {
    const root = fixture(0)
    rmSync(join(root, 'docs/persistence-changes/historical-formats'), { recursive: true })
    expect(runPersistenceFormats(['--root', root, '--archive', '0'])).toBe('Archived Session format v0 to docs/persistence-changes/historical-formats/v0.schema.json.')
    expect(JSON.parse(readFileSync(join(root, 'docs/persistence-changes/historical-formats/v0.schema.json'), 'utf8'))).toEqual(inventory(0))
  })

  it.each(['-1', '1.5', '01', '3junk', '9007199254740992'])('rejects an invalid archive version %s', (version) => {
    const root = fixture()
    expect(() => runPersistenceFormats([`--archive=${version}`], root)).toThrow('--archive must be a non-negative safe integer')
    expect(existsSync(join(root, 'docs/persistence-changes/historical-formats/v3.schema.json'))).toBe(false)
  })

  it.each(['2', '4'])('rejects archive v%s when the current writer is v3', (version) => {
    const root = fixture()
    expect(() => runPersistenceFormats(['--archive', version], root)).toThrow(`Cannot archive v${version}: current writer is v3`)
    expect(existsSync(join(root, 'docs/persistence-changes/historical-formats/v3.schema.json'))).toBe(false)
  })

  it('refuses to overwrite an existing archive', () => {
    const root = fixture()
    write(root, 'docs/persistence-changes/historical-formats/v3.schema.json', 'Retained history.\n')
    expect(() => runPersistenceFormats(['--archive', '3'], root)).toThrow('docs/persistence-changes/historical-formats/v3.schema.json already exists')
    expect(readFileSync(join(root, 'docs/persistence-changes/historical-formats/v3.schema.json'), 'utf8')).toBe('Retained history.\n')
  })

  it('rejects --archive with --write before writing', () => {
    const root = fixture()
    expect(() => runPersistenceFormats(['--archive', '3', '--write'], root)).toThrow('--archive and --write cannot be combined')
    expect(existsSync(join(root, 'docs/persistence-changes/historical-formats/v3.schema.json'))).toBe(false)
  })

  it.each(['invalid-json', 'digest-drift', 'missing-type', 'missing-source-metadata', 'outdated-header'])('rejects %s before creating an archive', (variant) => {
    const root = fixture()
    const original = inventory(3)
    if (variant === 'invalid-json') write(root, 'docs/persistence-schema.json', '{')
    else if (variant === 'digest-drift') replaceSnapshot(root, 3, 3, { ...original, roots: [{ ...original.roots[0]!, digest: '0'.repeat(64) }, ...original.roots.slice(1)] })
    else if (variant === 'missing-type') replaceSnapshot(root, 3, 3, { ...original, types: original.types.slice(1) })
    else if (variant === 'missing-source-metadata') edit(root, 'docs/persistence-schema.json', ',"sources":[]', '')
    else replaceSnapshot(root, 3, 3, inventory(2))
    expect(() => runPersistenceFormats(['--archive', '3'], root)).toThrow(variant === 'invalid-json' ? SyntaxError
      : variant === 'digest-drift' ? 'schema digest mismatch' : variant === 'missing-type' ? 'cover every reachable type'
        : variant === 'missing-source-metadata' ? 'missing field sources' : 'SessionHeader.version must match')
    expect(existsSync(join(root, 'docs/persistence-changes/historical-formats/v3.schema.json'))).toBe(false)
  })
})
