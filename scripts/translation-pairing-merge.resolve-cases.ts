/**
 * Explicit resolution of already-stopped merges: index stages, unstaged owner
 * bytes, edited sidecars, and pairs left conflicted on purpose.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  expectMergedPair,
  mergedSource,
  startMixedPairingMerge,
  startStoppedPairingMerge,
} from './translation-pairing-merge.corpus.ts'
import {
  createFixture,
  git,
  pairingMergeSuite,
  resolveTranslationPairingConflicts,
  write,
} from './translation-pairing-merge.fixtures.ts'

pairingMergeSuite(() => {
  it('resolves an already-stopped generated-only conflict from index stages', () => {
    const fixture = createFixture(false)
    startStoppedPairingMerge(fixture)

    expect(resolveTranslationPairingConflicts(fixture.root)).toEqual(['docs/guide.i18n.yaml'])

    expect(git(fixture, ['diff', '--name-only', '--diff-filter=U'])).toBe('')
    expectMergedPair(fixture)
  })

  it('refuses to confirm unstaged owner bytes after a stopped merge', () => {
    const fixture = createFixture(false)
    startStoppedPairingMerge(fixture)
    write(fixture.root, 'docs/guide.md', `${mergedSource}\nunstaged\n`)

    expect(() => resolveTranslationPairingConflicts(fixture.root)).toThrow(
      'docs/guide.md has unstaged content',
    )
    expect(git(fixture, ['diff', '--name-only', '--diff-filter=U'])).toBe('docs/guide.i18n.yaml')
  })

  it('refuses to overwrite an edited sidecar after a stopped merge', () => {
    const fixture = createFixture(false)
    startStoppedPairingMerge(fixture)
    write(fixture.root, 'docs/guide.i18n.yaml', 'manually resolved\n')

    expect(() => resolveTranslationPairingConflicts(fixture.root)).toThrow(
      'docs/guide.i18n.yaml has edited conflict content',
    )
    expect(readFileSync(join(fixture.root, 'docs/guide.i18n.yaml'), 'utf8')).toBe('manually resolved\n')
    expect(git(fixture, ['diff', '--name-only', '--diff-filter=U'])).toBe('docs/guide.i18n.yaml')
  })

  it('resolves safe records while leaving an owner-conflicted pair untouched', () => {
    const fixture = createFixture(false)
    startMixedPairingMerge(fixture)

    expect(() => resolveTranslationPairingConflicts(fixture.root)).toThrow(
      'docs/manual.i18n.yaml: docs/manual.md has content conflicts',
    )

    expect(git(fixture, ['diff', '--name-only', '--diff-filter=U']).split('\n')).toEqual([
      'docs/manual.i18n.yaml',
      'docs/manual.md',
      'docs/manual.zh.md',
    ])
    expectMergedPair(fixture)
  })
})
