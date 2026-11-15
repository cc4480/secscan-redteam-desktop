/** Baseline inventory enforcement: accepted drift, rejected additions, and malformed records. */

import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countUnknownCasts, findUnknownCasts, verifyNoUnknownCasts } from './verify-no-unknown-casts.ts'
import {
  assertion,
  baselinePath,
  fixture,
  git,
  recordBaseline,
  sourcePath,
  write,
} from './verify-no-unknown-casts.fixtures.ts'

describe('unknown assertion inventory', () => {
  it('accepts recorded assertions after formatting without rewriting the baseline', () => {
    const root = fixture()
    write(root, sourcePath, assertion)
    const baseline = recordBaseline(root)
    write(root, sourcePath, 'const result = value as\n /* reason */ unknown\n')
    expect(verifyNoUnknownCasts(root)).toBe(1)
    expect(verifyNoUnknownCasts(root, true)).toBe(1)
    expect(readFileSync(join(root, baselinePath), 'utf8')).toBe(baseline)
  })

  it.each([
    ['additional assertion', `${assertion}const other = input as unknown\n`],
    ['duplicate assertion', `${assertion}${assertion}`],
    ['replacement assertion', 'const result = other as unknown\n'],
    ['union assertion', 'const result = value as unknown | string\n'],
  ])('rejects an %s without changing the baseline', (_name, text) => {
    const root = fixture()
    write(root, sourcePath, assertion)
    const baseline = recordBaseline(root)
    write(root, sourcePath, text)
    expect(() => verifyNoUnknownCasts(root)).toThrow(/new assertions to unknown/u)
    expect(() => verifyNoUnknownCasts(root, true)).toThrow(/new assertions to unknown/u)
    expect(readFileSync(join(root, baselinePath), 'utf8')).toBe(baseline)
  })

  it.each([
    assertion,
    'const result = value as (unknown | never)\n',
    'const result = value as string | (unknown | number)\n',
    String.raw`const result = value as \u0075nknown`,
  ])('rejects a new assertion when the inventory is empty: %s', (text) => {
    const root = fixture()
    write(root, sourcePath, text)
    expect(() => verifyNoUnknownCasts(root)).toThrow(`${sourcePath}:1`)
  })

  it('requires pruning retired counts while preserving the remaining assertion', () => {
    const root = fixture()
    write(root, sourcePath, `${assertion}${assertion}`)
    write(root, 'apps/retired.ts', 'const retired = input as unknown\n')
    recordBaseline(root)
    write(root, sourcePath, assertion)
    unlinkSync(join(root, 'apps/retired.ts'))
    expect(() => verifyNoUnknownCasts(root)).toThrow(/remove retired baseline entries/u)
    expect(verifyNoUnknownCasts(root, true)).toBe(1)
    expect(JSON.parse(readFileSync(join(root, baselinePath), 'utf8'))).toEqual(
      countUnknownCasts(findUnknownCasts(sourcePath, assertion)),
    )
    expect(verifyNoUnknownCasts(root)).toBe(1)
  })

  it('prunes a deleted tracked file without treating it as a discovery failure', () => {
    const root = fixture()
    write(root, sourcePath, assertion)
    git(root, 'add', sourcePath)
    recordBaseline(root)
    unlinkSync(join(root, sourcePath))
    expect(() => verifyNoUnknownCasts(root)).toThrow(/remove retired baseline entries/u)
    expect(verifyNoUnknownCasts(root, true)).toBe(0)
    expect(readFileSync(join(root, baselinePath), 'utf8')).toBe('{}\n')
  })

  it.each([
    ['not an object', '[]'],
    ['null', 'null'],
    ['invalid JSON', '{'],
    ['non-source path', '{"input.json":{"HASH":1}}'],
    ['absolute path', '{"/input.ts":{"HASH":1}}'],
    ['parent path', '{"../input.ts":{"HASH":1}}'],
    ['backslash path', JSON.stringify({ 'packages\\input.ts': { HASH: 1 } })],
    ['excluded path', '{"vendor/input.ts":{"HASH":1}}'],
    ['empty file counts', '{"input.ts":{}}'],
    ['array counts', '{"input.ts":[]}'],
    ['invalid fingerprint', '{"input.ts":{"invalid":1}}'],
    ['zero count', '{"input.ts":{"HASH":0}}'],
    ['negative count', '{"input.ts":{"HASH":-1}}'],
    ['fractional count', '{"input.ts":{"HASH":1.5}}'],
    ['unsafe count', '{"input.ts":{"HASH":9007199254740992}}'],
    ['string count', '{"input.ts":{"HASH":"1"}}'],
  ])('rejects a malformed baseline: %s', (_name, text) => {
    const root = fixture()
    const contents = text.replaceAll('HASH', 'a'.repeat(64))
    write(root, baselinePath, contents)
    expect(() => verifyNoUnknownCasts(root, true)).toThrow()
    expect(readFileSync(join(root, baselinePath), 'utf8')).toBe(contents)
  })
})
