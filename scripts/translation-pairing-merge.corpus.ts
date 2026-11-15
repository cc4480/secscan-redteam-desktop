/** Corpus contents, diverged-branch builders, and merged-pair assertions for the merge cases. */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'
import { gitBlobHash } from './translation-pairing-git.ts'
import {
  renderTranslationPairingRecord,
  translationPairPaths,
} from './translation-pairing-record.ts'
import { type Fixture, git, record, write } from './translation-pairing-merge.fixtures.ts'

/** English source every authored pair starts from. */
export const baseSource = '# Guide\n\nEnglish | [中文](guide.zh.md)\n\nAlpha base.\n\nBeta base.\n'
/** Chinese translation matching {@link baseSource}. */
export const baseZh = '# 指南\n\n[English](guide.md) | 中文\n\n甲基础。\n\n乙基础。\n'
/** {@link baseSource} after the checked-out branch's first edit. */
export const currentSource = baseSource.replace('Alpha base.', 'Alpha current.')
/** {@link baseZh} after the checked-out branch's first edit. */
export const currentZh = baseZh.replace('甲基础。', '甲当前。')
/** {@link baseSource} after the merged branch's last edit. */
export const otherSource = baseSource.replace('Beta base.', 'Beta other.')
/** {@link baseZh} after the merged branch's last edit. */
export const otherZh = baseZh.replace('乙基础。', '乙对侧。')
/** The clean text merge of {@link currentSource} and {@link otherSource}. */
export const mergedSource = currentSource.replace('Beta base.', 'Beta other.')
/** The clean text merge of {@link currentZh} and {@link otherZh}. */
export const mergedZh = currentZh.replace('乙基础。', '乙对侧。')
/** Generated English source, which carries no language switcher. */
export const generatedBaseSource = '# Module graph\n\nAlpha base.\n\nBeta base.\n'
/** Generated Chinese translation, which carries only the backlink. */
export const generatedBaseZh = '# 模块图\n\n[English](module-graph.md) | 中文\n\n甲基础。\n\n乙基础。\n'
/** {@link generatedBaseSource} after the checked-out branch's edit. */
export const generatedCurrentSource = generatedBaseSource.replace('Alpha base.', 'Alpha current.')
/** {@link generatedBaseZh} after the checked-out branch's edit. */
export const generatedCurrentZh = generatedBaseZh.replace('甲基础。', '甲当前。')
/** {@link generatedBaseSource} after the merged branch's edit. */
export const generatedOtherSource = generatedBaseSource.replace('Beta base.', 'Beta other.')
/** {@link generatedBaseZh} after the merged branch's edit. */
export const generatedOtherZh = generatedBaseZh.replace('乙基础。', '乙对侧。')
/** {@link baseSource} rewritten to pair with `docs/manual.zh.md`. */
export const manualBaseSource = baseSource.replace('guide.zh.md', 'manual.zh.md')
/** {@link baseZh} rewritten to pair with `docs/manual.md`. */
export const manualBaseZh = baseZh.replace('guide.md', 'manual.md')
/** The manual pair's checked-out-branch source. */
export const manualCurrentSource = manualBaseSource.replace('Alpha base.', 'Alpha current.')
/** The manual pair's checked-out-branch translation. */
export const manualCurrentZh = manualBaseZh.replace('甲基础。', '甲当前。')
/** The manual pair's merged-branch source. */
export const manualOtherSource = manualBaseSource.replace('Alpha base.', 'Alpha other.')
/** The manual pair's merged-branch translation. */
export const manualOtherZh = manualBaseZh.replace('甲基础。', '甲对侧。')

/**
 * Commits one `docs/guide.md` pair with its record.
 * @param fixture - fixture to commit in.
 * @param source - English source content.
 * @param zh - Chinese translation content.
 * @param message - commit message.
 * @returns the committed record content.
 */
export function commitPair(fixture: Fixture, source: string, zh: string, message: string): string {
  const sidecar = record(fixture.root, 'docs/guide.md', source, zh)
  git(fixture, ['add', '.'])
  git(fixture, ['commit', '-m', message])
  return sidecar
}

/**
 * Commits one `docs/guide.md` pair whose record merges as plain text.
 * @param fixture - fixture to commit in.
 * @param source - English source content.
 * @param zh - Chinese translation content.
 * @param message - commit message.
 * @returns nothing.
 */
export function commitTextCleanPair(fixture: Fixture, source: string, zh: string, message: string): void {
  const sidecar = record(fixture.root, 'docs/guide.md', source, zh)
  write(
    fixture.root,
    'docs/guide.i18n.yaml',
    sidecar.replace('\nguide.zh.md:', '\n# Stable separator for independent line merges.\nguide.zh.md:'),
  )
  git(fixture, ['add', '.'])
  git(fixture, ['commit', '-m', message])
}

/**
 * Builds a `current` and `master` branch that both diverge from one committed pair.
 * @param fixture - fixture to build the branches in.
 * @returns the three record contents the branches hold.
 */
export function createDivergedPair(fixture: Fixture): { ancestor: string; current: string; other: string } {
  const ancestor = commitPair(fixture, baseSource, baseZh, 'base')
  git(fixture, ['switch', '-c', 'current'])
  const current = commitPair(fixture, currentSource, currentZh, 'current')
  git(fixture, ['switch', 'master'])
  const other = commitPair(fixture, otherSource, otherZh, 'other')
  git(fixture, ['switch', 'current'])
  return { ancestor, current, other }
}

/**
 * Builds two branches whose owner edits touch independent lines of the same pair.
 * @param fixture - fixture to build the branches in.
 * @returns nothing.
 */
export function createTextCleanDivergedPair(fixture: Fixture): void {
  commitTextCleanPair(fixture, baseSource, baseZh, 'base')
  git(fixture, ['switch', '-c', 'current'])
  commitTextCleanPair(fixture, currentSource, baseZh, 'current source')
  git(fixture, ['switch', 'master'])
  commitTextCleanPair(fixture, baseSource, otherZh, 'other translation')
  git(fixture, ['switch', 'current'])
}

/**
 * Leaves a stopped pairing merge whose only conflict is the record.
 * @param fixture - fixture to merge in.
 * @returns nothing.
 */
export function startStoppedPairingMerge(fixture: Fixture): void {
  createDivergedPair(fixture)
  const merge = spawnSync('git', ['-C', fixture.root, 'merge', '--no-commit', 'master'], {
    encoding: 'utf8',
    env: fixture.env,
  })
  expect(merge.status).toBe(1)
  expect(git(fixture, ['diff', '--name-only', '--diff-filter=U'])).toBe('docs/guide.i18n.yaml')
}

/**
 * Commits both the guide and manual pairs of a fixture.
 * @param fixture - fixture to commit in.
 * @param guide - guide pair contents.
 * @param guide.source - guide English source content.
 * @param guide.zh - guide Chinese translation content.
 * @param manual - manual pair contents.
 * @param manual.source - manual English source content.
 * @param manual.zh - manual Chinese translation content.
 * @param message - commit message.
 * @returns nothing.
 */
export function commitMixedPairs(
  fixture: Fixture,
  guide: { source: string; zh: string },
  manual: { source: string; zh: string },
  message: string,
): void {
  record(fixture.root, 'docs/guide.md', guide.source, guide.zh)
  record(fixture.root, 'docs/manual.md', manual.source, manual.zh)
  git(fixture, ['add', '.'])
  git(fixture, ['commit', '-m', message])
}

/**
 * Leaves a stopped merge that conflicts on the guide record and on both manual owners.
 * @param fixture - fixture to merge in.
 * @returns nothing.
 */
export function startMixedPairingMerge(fixture: Fixture): void {
  commitMixedPairs(
    fixture,
    { source: baseSource, zh: baseZh },
    { source: manualBaseSource, zh: manualBaseZh },
    'base',
  )
  git(fixture, ['switch', '-c', 'current'])
  commitMixedPairs(
    fixture,
    { source: currentSource, zh: currentZh },
    { source: manualCurrentSource, zh: manualCurrentZh },
    'current',
  )
  git(fixture, ['switch', 'master'])
  commitMixedPairs(
    fixture,
    { source: otherSource, zh: otherZh },
    { source: manualOtherSource, zh: manualOtherZh },
    'other',
  )
  git(fixture, ['switch', 'current'])
  const merge = spawnSync('git', ['-C', fixture.root, 'merge', '--no-commit', 'master'], {
    encoding: 'utf8',
    env: fixture.env,
  })
  expect(merge.status).toBe(1)
}

/**
 * Asserts that the guide pair, and its record, hold the composed merge.
 * @param fixture - fixture holding the merged checkout.
 * @returns nothing.
 */
export function expectMergedPair(fixture: Fixture): void {
  expect(readFileSync(join(fixture.root, 'docs/guide.md'), 'utf8')).toBe(mergedSource)
  expect(readFileSync(join(fixture.root, 'docs/guide.zh.md'), 'utf8')).toBe(mergedZh)
  expect(readFileSync(join(fixture.root, 'docs/guide.i18n.yaml'), 'utf8')).toBe(
    renderTranslationPairingRecord(translationPairPaths('docs/guide.md'), {
      sourceHash: gitBlobHash(Buffer.from(mergedSource)),
      zhHash: gitBlobHash(Buffer.from(mergedZh)),
    }),
  )
}
