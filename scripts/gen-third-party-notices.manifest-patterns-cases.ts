/** Manifest discovery globs derived from the declared workspace members. */

import { describe, expect, it } from 'vitest'
import { manifestPatterns } from './gen-third-party-notices.ts'

describe('manifestPatterns', () => {
  it('derives globs from the declared members, so a new member area is read', () => {
    expect(manifestPatterns(['packages/*/*', 'tools/*', 'native/system', 'native/system/packages/*'])).toEqual([
      'package.json',
      'packages/*/*/package.json',
      'tools/*/package.json',
      'native/system/package.json',
      'native/system/packages/*/package.json',
    ])
  })
})
