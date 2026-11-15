/**
 * Driver execution through real merges: the launcher, its runtime fallback, the
 * explicit resolver hand-off, staged merges, and the recovery-path message.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { gitBlobHash } from './translation-pairing-git.ts'
import {
  baseSource,
  baseZh,
  commitPair,
  createDivergedPair,
  createTextCleanDivergedPair,
  currentSource,
  currentZh,
  expectMergedPair,
  otherZh,
} from './translation-pairing-merge.corpus.ts'
import {
  createFixture,
  driver,
  git,
  installFixtureRuntime,
  pairingMergeSuite,
  record,
  resolveTranslationPairingConflicts,
  startMergeWithFakeNode,
  tsxLoader,
  write,
} from './translation-pairing-merge.fixtures.ts'
import {
  renderTranslationPairingRecord,
  translationPairPaths,
} from './translation-pairing-record.ts'

pairingMergeSuite(() => {
  it('runs as Git\'s custom driver and commits a clean composed record', () => {
    const fixture = createFixture()
    createDivergedPair(fixture)
    installFixtureRuntime(fixture.root)
    git(fixture, [
      'config',
      'merge.dsh-translation-pairing.driver',
      'scripts/merge-translation-pairing-driver.sh %O %A %B %P',
    ])

    git(fixture, ['merge', '--no-edit', 'master'])

    expect(git(fixture, ['diff', '--name-only', '--diff-filter=U'])).toBe('')
    expectMergedPair(fixture)
  })

  it('sees a paired link target added by the other branch', () => {
    const fixture = createFixture()
    commitPair(fixture, baseSource, baseZh, 'base')
    git(fixture, ['switch', '-c', 'current'])
    commitPair(fixture, currentSource, currentZh, 'current guide')
    git(fixture, ['switch', 'master'])
    record(
      fixture.root,
      'docs/guide.md',
      baseSource.replace('Beta base.', '[Reference](reference.md#overview)'),
      baseZh.replace('乙基础。', '[参考](reference.zh.md#overview)'),
    )
    record(
      fixture.root,
      'docs/reference.md',
      '# Reference\n\nEnglish | [中文](reference.zh.md)\n\nOverview.\n',
      '# 参考\n\n[English](reference.md) | 中文\n\n概览。\n',
    )
    git(fixture, ['add', '.'])
    git(fixture, ['commit', '-m', 'other guide and target'])
    git(fixture, ['switch', 'current'])
    installFixtureRuntime(fixture.root)
    git(fixture, [
      'config',
      'merge.dsh-translation-pairing.driver',
      'scripts/merge-translation-pairing-driver.sh %O %A %B %P',
    ])

    const merge = spawnSync('git', ['-C', fixture.root, 'merge', '--no-edit', 'master'], {
      encoding: 'utf8',
      env: fixture.env,
    })

    expect(merge.status, merge.stderr).toBe(0)
    expect(git(fixture, ['diff', '--name-only', '--diff-filter=U'])).toBe('')
    expect(readFileSync(join(fixture.root, 'docs/guide.md'), 'utf8')).toContain(
      '[Reference](reference.md#overview)',
    )
    expect(readFileSync(join(fixture.root, 'docs/guide.zh.md'), 'utf8')).toContain(
      '[参考](reference.zh.md#overview)',
    )
  })

  it('leaves an ordinary recoverable conflict when the configured runtime is unavailable', () => {
    const fixture = createFixture()
    const records = createDivergedPair(fixture)
    const headBefore = git(fixture, ['rev-parse', 'HEAD'])

    const result = startMergeWithFakeNode(fixture)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('runtime is unavailable; leaving an ordinary text conflict')
    expect(git(fixture, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(git(fixture, ['rev-parse', '--verify', 'MERGE_HEAD'])).not.toBe('')
    expect(git(fixture, ['diff', '--name-only', '--diff-filter=U'])).toBe('docs/guide.i18n.yaml')
    expect(git(fixture, ['ls-files', '--unmerged', '--', 'docs/guide.i18n.yaml']).split('\n')).toHaveLength(3)
    const conflicted = readFileSync(join(fixture.root, 'docs/guide.i18n.yaml'), 'utf8')
    expect(conflicted).toContain('<<<<<<< docs/guide.i18n.yaml:current')
    for (const record of [records.current, records.other]) {
      const dataLines = record.split('\n').filter(line => line !== '' && !line.startsWith('#')).join('\n')
      expect(conflicted).toContain(dataLines)
    }

    expect(resolveTranslationPairingConflicts(fixture.root)).toEqual(['docs/guide.i18n.yaml'])
    expectMergedPair(fixture)
  })

  it('falls back before a broken driver entrypoint can replace the launcher', () => {
    const fixture = createFixture()
    createDivergedPair(fixture)
    const result = startMergeWithFakeNode(
      fixture,
      '#!/bin/sh\nif [ "$3" = "--eval" ]; then exit 0; fi\nexit 72\n',
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('runtime is unavailable; leaving an ordinary text conflict')
    expect(readFileSync(join(fixture.root, 'docs/guide.i18n.yaml'), 'utf8')).toContain(
      '<<<<<<< docs/guide.i18n.yaml:current',
    )
  })

  it('keeps a clean text fallback unresolved until the explicit resolver confirms it', () => {
    const fixture = createFixture()
    createTextCleanDivergedPair(fixture)
    const result = startMergeWithFakeNode(fixture)

    expect(result.status).toBe(1)
    expect(git(fixture, ['diff', '--name-only', '--diff-filter=U'])).toBe('docs/guide.i18n.yaml')
    const canonicalRecord = renderTranslationPairingRecord(translationPairPaths('docs/guide.md'), {
      sourceHash: gitBlobHash(Buffer.from(currentSource)),
      zhHash: gitBlobHash(Buffer.from(otherZh)),
    })
    expect(readFileSync(join(fixture.root, 'docs/guide.i18n.yaml'), 'utf8')).toBe(
      canonicalRecord.replace(
        '\nguide.zh.md:',
        '\n# Stable separator for independent line merges.\nguide.zh.md:',
      ),
    )

    expect(resolveTranslationPairingConflicts(fixture.root)).toEqual(['docs/guide.i18n.yaml'])
    expect(readFileSync(join(fixture.root, 'docs/guide.md'), 'utf8')).toBe(currentSource)
    expect(readFileSync(join(fixture.root, 'docs/guide.zh.md'), 'utf8')).toBe(otherZh)
    expect(readFileSync(join(fixture.root, 'docs/guide.i18n.yaml'), 'utf8')).toBe(canonicalRecord)
  })

  it('leaves a staged merge when the pre-merge-commit hook rejects it', () => {
    const fixture = createFixture()
    createDivergedPair(fixture)
    installFixtureRuntime(fixture.root)
    git(fixture, [
      'config',
      'merge.dsh-translation-pairing.driver',
      'scripts/merge-translation-pairing-driver.sh %O %A %B %P',
    ])
    const hooks = join(fixture.root, 'hooks')
    write(
      fixture.root,
      'hooks/pre-merge-commit',
      '#!/bin/sh\necho "fixture pre-merge-commit rejection" >&2\nexit 77\n',
    )
    chmodSync(join(hooks, 'pre-merge-commit'), 0o755)
    git(fixture, ['config', 'core.hooksPath', hooks])
    const headBefore = git(fixture, ['rev-parse', 'HEAD'])

    const result = spawnSync('git', ['-C', fixture.root, 'merge', '--no-edit', 'master'], {
      encoding: 'utf8',
      env: fixture.env,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('fixture pre-merge-commit rejection')
    expect(git(fixture, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(git(fixture, ['rev-parse', '--verify', 'MERGE_HEAD'])).not.toBe('')
    expect(git(fixture, ['diff', '--name-only', '--diff-filter=U'])).toBe('')
    expect(git(fixture, ['diff', '--cached', '--name-only']).split('\n')).toContain(
      'docs/guide.i18n.yaml',
    )
    expectMergedPair(fixture)
  })

  it('prints the recovery path when driver input is not composable', () => {
    const fixture = createFixture(false)
    const result = spawnSync(process.execPath, ['--import', tsxLoader, driver], {
      cwd: fixture.root,
      encoding: 'utf8',
      env: fixture.env,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('pnpm run verify-translation-pairing --write <pair>')
    expect(result.stderr).toContain('pnpm run resolve-translation-pairing-conflicts')
  })
})
