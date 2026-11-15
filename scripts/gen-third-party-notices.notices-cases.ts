/** Freshness of the committed third-party notice document. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import primaryRuntimeLock from './primary-runtime/lock.json' with { type: 'json' }
import { render } from './gen-third-party-notices.ts'

const root = resolve(import.meta.dirname, '..')

describe('THIRD_PARTY_NOTICES.md', () => {
  // Freshness lives here rather than in its own doc-sync gate: this spec file
  // already runs in the test lane, so the check costs no extra CI process.
  // Pre-commit regenerates the file whenever a manifest is staged, so reaching
  // this assertion means the notices were committed without that hook.
  // This case resolves all browser build graphs as well as installed license metadata.
  it('matches what the generator produces from the current manifests', {
    timeout: 120_000,
  }, async () => {
    const generated = await render()
    expect(generated).toContain('It depends on the third-party software listed below.')
    expect(generated).toContain(`| [\`numpy\`](https://github.com/numpy/numpy) | ${primaryRuntimeLock.pythonPackages.numpy} | BSD-3-Clause |`)
    expect(generated).toContain('## LibreOffice conversion kit')
    expect(generated).toContain('Recipients must have access to those corresponding sources and notices.')
    expect(readFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'), 'stale notices — run `pnpm run gen-third-party-notices`').toBe(generated)
  })
})
