/** Detection of assertion-to-unknown syntax: admitted forms, excluded forms, and fingerprints. */

import { describe, expect, it } from 'vitest'
import { findUnknownCasts } from './verify-no-unknown-casts.ts'

describe('unknown assertion syntax', () => {
  it.each([
    ['standalone', 'input.ts', 'value as unknown', 1],
    ['double assertion', 'input.ts', 'value as unknown as Result', 1],
    ['nested assertions', 'input.ts', '(value as unknown) as unknown', 2],
    ['multiline', 'input.ts', 'value as\nunknown', 1],
    ['comment-separated', 'input.ts', 'value as /* explanation */ unknown', 1],
    ['parenthesized type', 'input.ts', 'value as ((unknown))', 1],
    ['angle assertion', 'input.ts', '<unknown>value', 1],
    ['parenthesized angle type', 'input.ts', '<(unknown)>value', 1],
    ['union', 'input.ts', 'value as unknown | string', 1],
    ['union with trailing unknown', 'input.ts', 'value as string | unknown', 1],
    ['parenthesized union', 'input.ts', 'value as (unknown | never)', 1],
    ['nested union', 'input.ts', 'value as string | (unknown | number)', 1],
    ['angle union assertion', 'input.ts', '<unknown | string>value', 1],
    ['escaped keyword', 'input.ts', String.raw`value as \u0075nknown`, 1],
    ['TSX expression', 'input.tsx', '<View value={input as unknown} />', 1],
    ['template interpolation', 'input.ts', '`text ${value as unknown}`', 1],
  ])('finds %s', (_name, file, text, count) => {
    expect(findUnknownCasts(file, text)).toHaveLength(count)
  })

  it.each([
    '// value as unknown\n/* <unknown>value */',
    'const text = "value as unknown"',
    'const text = `value as unknown`',
    'const result = value as unknown[]',
    'const result = value as Record<string, unknown>',
    'const result = value as unknown[] | string',
    'const result = value as unknown & { id: string }',
    'const result = value as string | (unknown & { id: string })',
    'const result = <unknown[]>value',
    'const result: unknown = value',
    'type Input = unknown; const result = value as Input',
    'type Input = unknown; const result = value as Input | string',
  ])('accepts source without a direct assertion: %s', (text) => {
    expect(findUnknownCasts('input.ts', text)).toEqual([])
  })

  it('accepts JSX text without ignoring assertions in expressions', () => {
    expect(findUnknownCasts('input.tsx', '<View>as unknown</View>')).toEqual([])
    expect(findUnknownCasts('input.tsx', '<View>{value as unknown}</View>')).toHaveLength(1)
  })

  it('excludes JavaScript JSDoc assertions', () => {
    expect(findUnknownCasts('input.js', 'const result = /** @type {unknown} */ (value)')).toEqual([])
  })

  it('reports normalized paths and the asserted type line', () => {
    const casts = findUnknownCasts('packages\\example\\index.ts', '\nvalue as\nunknown')
    expect(casts).toHaveLength(1)
    expect(casts[0]).toMatchObject({ file: 'packages/example/index.ts', line: 3 })
    expect(casts[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('keeps syntax fingerprints through whitespace and comment edits', () => {
    const original = findUnknownCasts('input.ts', 'call(value, "text") as unknown')
    const formatted = findUnknownCasts('input.ts', '\ncall /* call */ (value,\n "text") as /* type */ unknown')
    expect(formatted.map(cast => cast.fingerprint)).toEqual(original.map(cast => cast.fingerprint))
    expect(findUnknownCasts('input.ts', 'call(value, "other") as unknown').map(cast => cast.fingerprint))
      .not.toEqual(original.map(cast => cast.fingerprint))
  })

  it.each([
    ['value as unknown', '6fe9024d30e0d4757a348b83d246925b3f5aeaf2e79a0eff4bf12f3c9fb5826b'],
    ['call() as unknown', '49f7ac9934e1a7fc08876cdf6f900bd05c74d7d25801b6ec2d4eed02c3221f8d'],
  ])('preserves the recorded fingerprint for %s', (text, fingerprint) => {
    expect(findUnknownCasts('input.ts', text)[0]?.fingerprint).toBe(fingerprint)
  })
})
