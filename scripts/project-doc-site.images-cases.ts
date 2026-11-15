/** Cases for repository-owned image resolution and the published repository ref. */

import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { publishableImage, resolveRepositoryRef } from './project-doc-site.ts'
import { fixture, roots } from './project-doc-site.fixtures.ts'

describe('publishableImage', () => {
  it('accepts a regular file inside the repository', () => {
    const { root } = fixture()
    const real = realpathSync(join(root, 'packages/logo.svg'))
    expect(publishableImage(join(root, 'packages/logo.svg'), realpathSync(root))).toBe(real)
  })

  it('refuses a target whose real path escapes the repository', () => {
    // Publication copies the bytes onto the site, so a reference reaching a
    // build-machine file must not be treated as an image the repository owns.
    const { root } = fixture()
    const outside = mkdtempSync(join(tmpdir(), 'dsh-doc-site-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'secret.png'), 'not really a png\n')
    symlinkSync(join(outside, 'secret.png'), join(root, 'packages/linked.png'))

    expect(publishableImage(join(root, 'packages/linked.png'), realpathSync(root))).toBeUndefined()
    expect(publishableImage(join(outside, 'secret.png'), realpathSync(root))).toBeUndefined()
  })

  it('refuses a directory', () => {
    const { root } = fixture()
    expect(publishableImage(join(root, 'packages'), realpathSync(root))).toBeUndefined()
  })
})

describe('resolveRepositoryRef', () => {
  it('defaults to public master instead of a private workflow SHA', () => {
    expect(resolveRepositoryRef({ GITHUB_SHA: 'private-sha' })).toBe('master')
  })

  it('accepts an explicit public repository ref', () => {
    expect(resolveRepositoryRef({ DOCS_REPOSITORY_REF: 'public-sha' })).toBe('public-sha')
  })
})
