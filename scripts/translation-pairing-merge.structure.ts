/** Pairing-structure validation of the two cleanly merged owner documents. */

import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { gitMergeInputPaths } from './translation-pairing-git.ts'
import {
  languageSwitcherTargets,
  parseTranslationMarkdown,
  requiresSourceLanguageSwitcher,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'
import {
  hasLanguageSwitcher,
  translationLinkLocaleViolations,
} from './translation-links.ts'
import type { TranslationPairPaths } from './translation-pairing-record.ts'

/**
 * Normalize a sidecar path to a repository-relative POSIX path.
 *
 * @param root - Repository root the path is resolved against.
 * @param meta - Sidecar path from the pairing record.
 * @returns The normalized repository-relative path.
 * @throws Error when the path is absolute or escapes the repository.
 */
export function normalizeMetaPath(root: string, meta: string): string {
  if (isAbsolute(meta)) throw new Error(`pairing record must be repository-relative: ${JSON.stringify(meta)}`)
  const repositoryRelative = relative(resolve(root), resolve(root, meta))
  if (repositoryRelative === '' || repositoryRelative === '..' || repositoryRelative.startsWith(`..${sep}`)) {
    throw new Error(`pairing record escapes the repository: ${JSON.stringify(meta)}`)
  }
  return repositoryRelative.split(sep).join('/')
}

/**
 * Prove the merged owners still pair: switcher links, link locales, structure.
 *
 * @param root - Repository root the pair belongs to.
 * @param paths - The pairing record's owner paths.
 * @param source - Cleanly merged English owner content.
 * @param zh - Cleanly merged Simplified Chinese owner content.
 * @param isTranslationPairSource - Predicate for the active bilingual corpus.
 * @throws Error on a lost language switcher, a locale violation, or a structural divergence.
 */
export function assertMergedPairStructure(
  root: string,
  paths: TranslationPairPaths,
  source: Buffer,
  zh: Buffer,
  isTranslationPairSource: (sourcePath: string) => boolean,
): void {
  const sourceText = source.toString('utf8')
  const zhText = zh.toString('utf8')
  const sourceTree = parseTranslationMarkdown(sourceText)
  const zhTree = parseTranslationMarkdown(zhText)
  const indexFiles = gitMergeInputPaths(root)
  const repositoryFileExists = (path: string): boolean => indexFiles.has(path)
  const sourceSwitcherTargets = languageSwitcherTargets(paths.source)
  const zhSwitcherTargets = languageSwitcherTargets(paths.zh)
  if (requiresSourceLanguageSwitcher(paths.source)
    && !hasLanguageSwitcher(sourceTree, sourceText, zhSwitcherTargets)) {
    throw new Error(`${paths.source} clean merge lost its language-switcher link to ${basename(paths.zh)}`)
  }
  if (!hasLanguageSwitcher(zhTree, zhText, sourceSwitcherTargets)) {
    throw new Error(`${paths.zh} clean merge lost its language-switcher link to ${basename(paths.source)}`)
  }
  const localeViolations = [
    ...translationLinkLocaleViolations(sourceText, {
      repoRoot: root,
      sourcePath: paths.source,
      isTranslationPairSource,
      repositoryFileExists,
    }, zhSwitcherTargets),
    ...translationLinkLocaleViolations(zhText, {
      repoRoot: root,
      sourcePath: paths.zh,
      isTranslationPairSource,
      repositoryFileExists,
    }, sourceSwitcherTargets),
  ]
  if (localeViolations.length > 0) {
    const violation = localeViolations[0]
    if (violation === undefined) throw new Error('translation locale violation disappeared')
    throw new Error(`${violation.sourcePath}:${violation.line} clean merge uses ${JSON.stringify(violation.url)}; expected ${JSON.stringify(violation.expectedUrl)}`)
  }
  const divergences = translationStructureDiff(
    translationStructureSignature(sourceTree, zhSwitcherTargets, {
      repoRoot: root,
      sourcePath: paths.source,
      isTranslationPairSource,
      repositoryFileExists,
      markdown: sourceText,
    }),
    translationStructureSignature(zhTree, sourceSwitcherTargets, {
      repoRoot: root,
      sourcePath: paths.zh,
      isTranslationPairSource,
      repositoryFileExists,
      markdown: zhText,
    }),
  )
  if (divergences.length > 0) {
    throw new Error(`${paths.source} and ${paths.zh} clean merges diverge structurally: ${divergences.join('; ')}`)
  }
}
