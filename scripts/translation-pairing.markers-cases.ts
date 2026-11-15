/** Regression cases for generated-region partitioning and blob hashing. */

import { describe, expect, it } from 'vitest'
import { blobHash, partitionGeneratedRegions } from './translation-pairing.ts'

describe('generated regions', () => {
  const BEGIN = '<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->'
  const END = '<!-- END GENERATED cordis-surface -->'

  it('partitions marker-delimited regions from the hand-owned remainder', () => {
    const doc = `# T\n\nprose\n\n${BEGIN}\ninjected\n${END}\ntail\n`
    const { regions, stripped } = partitionGeneratedRegions(doc)
    expect(regions).toEqual([`${BEGIN}\ninjected\n${END}`])
    expect(stripped).toBe('# T\n\nprose\n\ntail\n')
  })

  it('treats a document without markers as one hand-owned remainder', () => {
    const { regions, stripped } = partitionGeneratedRegions('# T\n\nprose\n')
    expect(regions).toEqual([])
    expect(stripped).toBe('# T\n\nprose\n')
  })

  it('rejects unbalanced or nested markers', () => {
    expect(() => partitionGeneratedRegions(`${END}\n`)).toThrow('without a BEGIN')
    expect(() => partitionGeneratedRegions(`${BEGIN}\n`)).toThrow('without an END')
    expect(() => partitionGeneratedRegions(`${BEGIN}\n${BEGIN}\n${END}\n`)).toThrow('nested')
  })

  it('rejects mismatched slugs and malformed marker lines', () => {
    expect(() => partitionGeneratedRegions('<!-- BEGIN GENERATED a -->\nx\n<!-- END GENERATED b -->\n'))
      .toThrow("END slug 'b' does not match its BEGIN slug 'a'")
    expect(() => partitionGeneratedRegions('<!-- BEGIN GENERATED a --> trailing\nx\n<!-- END GENERATED a -->\n'))
      .toThrow('malformed generated region marker line')
    expect(() => partitionGeneratedRegions('x\n<!-- END GENERATED a --> tail\n'))
      .toThrow('malformed generated region marker line')
  })

  it('computes the exact git blob hash', () => {
    // `git hash-object` of the empty file and of "x\n" — pinned upstream values.
    expect(blobHash(Buffer.from(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(blobHash(Buffer.from('x\n'))).toBe('587be6b4c3f93f93c489c0111bba5596147a26cb')
  })
})
