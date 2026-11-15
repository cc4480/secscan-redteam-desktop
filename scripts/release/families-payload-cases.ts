/** The payload policy each family enforces, and the family metadata a release reads. */

import { describe, expect, it } from 'vitest'
import { releaseFamily } from './families.ts'
import { member } from './families-fixtures-cases.ts'

describe('release families', () => {
  it('applies the harness payload policy to dsh and keeps upstream payloads for vendored packages', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')
    const harness = member('packages/a/library', '@deepseek-ai/dsh-library')
    const vendored = member('vendor/cordis', '@deepseek-ai/cordis')

    expect(() => { dsh.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('dsh').installedEntry).toEqual({ packageName: '@deepseek-ai/dsh', binPath: 'lib/bin.js' })
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})
