/** Shared fixtures for the translation-pairing spec's structural cases. */

import { parseTranslationMarkdown, translationStructureSignature } from './translation-pairing.ts'

/** Admits every path as a translation-pair source so scope never masks a structural result. */
export const fixturePairSource = (): boolean => true

/**
 * Signatures one markdown document against a fixed counterpart target.
 * @param markdown - Document source to parse and sign.
 * @returns The structural signature the diff cases compare.
 */
export function signature(markdown: string) {
  return translationStructureSignature(
    parseTranslationMarkdown(markdown),
    'counterpart.zh.md',
    {
      repoRoot: process.cwd(), sourcePath: 'counterpart.md',
      isTranslationPairSource: fixturePairSource, repositoryFileExists: () => true, markdown,
    },
  )
}

/**
 * Signatures one document against a caller-chosen switcher target under a real root.
 * @param root - Repository root the link targets resolve inside.
 * @param sourcePath - Source document path relative to `root`.
 * @param markdown - Document source to parse and sign.
 * @param switcherTarget - Path of the counterpart language switcher target.
 * @returns The structural signature the diff cases compare.
 */
export function fixtureSignature(
  root: string,
  sourcePath: string,
  markdown: string,
  switcherTarget: string,
) {
  return translationStructureSignature(
    parseTranslationMarkdown(markdown),
    switcherTarget,
    { repoRoot: root, sourcePath, isTranslationPairSource: fixturePairSource, markdown },
  )
}
