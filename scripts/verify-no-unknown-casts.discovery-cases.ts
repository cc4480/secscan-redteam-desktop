/** Source discovery: tracked and untracked files, exclusions, area coverage, and symlinks. */

import { symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanUnknownCasts, verifyNoUnknownCasts } from './verify-no-unknown-casts.ts'
import { assertion, fixture, git, write } from './verify-no-unknown-casts.fixtures.ts'

describe('unknown assertion source discovery', () => {
  it('checks tracked source across areas, extensions, tests and root configuration', () => {
    const root = fixture()
    const files = [
      'packages/example/src/input.ts',
      'apps/example/input.tsx',
      'scripts/input.mts',
      'website/input.cts',
      'packages/example/tests/input.js',
      'apps/example/input.jsx',
      'scripts/input.mjs',
      'website/input.cjs',
      'config.ts',
    ]
    for (const file of files) write(root, file, assertion)
    git(root, 'add', '.')
    expect(scanUnknownCasts(root).map(cast => cast.file)).toEqual(files.toSorted())
    expect(() => verifyNoUnknownCasts(root)).toThrow(/new assertions to unknown/u)
  })

  it('includes untracked source while excluding ignored files, vendor, archives and other extensions', () => {
    const root = fixture()
    write(root, '.gitignore', 'ignored/\n')
    for (const file of ['ignored/input.ts', 'vendor/input.ts', '.agents/notes/archived/input.ts', 'docs/input.md']) {
      write(root, file, assertion)
    }
    git(root, 'add', '.')
    write(root, 'scripts/new.ts', assertion)
    expect(scanUnknownCasts(root).map(cast => cast.file)).toEqual(['scripts/new.ts'])
    expect(() => verifyNoUnknownCasts(root)).toThrow('scripts/new.ts:1')
    unlinkSync(join(root, 'scripts/new.ts'))
    expect(verifyNoUnknownCasts(root)).toBe(0)
  })

  it.each(['packages', 'apps', 'scripts', 'website'])('rejects discovery missing %s', (area) => {
    const root = fixture()
    unlinkSync(join(root, `${area}/seed.ts`))
    expect(() => verifyNoUnknownCasts(root)).toThrow(`source discovery omitted ${area}/`)
  })

  it('rejects an empty source corpus', () => {
    const root = fixture()
    for (const area of ['packages', 'apps', 'scripts', 'website']) unlinkSync(join(root, `${area}/seed.ts`))
    expect(() => verifyNoUnknownCasts(root)).toThrow(/source discovery omitted/u)
  })

  // Creating file symlinks requires privileges that Windows CI does not guarantee.
  it.skipIf(process.platform === 'win32')('rejects a source symlink', () => {
    const root = fixture()
    write(root, 'target.txt', assertion)
    const link = join(root, 'scripts/linked.ts')
    symlinkSync(join(root, 'target.txt'), link)
    try {
      expect(() => verifyNoUnknownCasts(root)).toThrow('source symlink is unsupported: scripts/linked.ts')
    } finally {
      unlinkSync(link)
    }
  })
})
