/** Mechanical composition of one pairing record from three staged sidecars. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readGitIndexBlob, storeGitBlob } from './translation-pairing-git.ts'
import {
  isTranslationScopeFile,
  parseTranslationPairingManifest,
  translationPairSourcePredicate,
} from './translation-pairing.ts'
import {
  renderTranslationPairingRecord,
  translationPairPathsFromMeta,
  type TranslationPairingRecord,
} from './translation-pairing-record.ts'
import {
  assertDefaultTextMerge,
  loadRecordOwners,
  mergeBlobTriplet,
} from './translation-pairing-merge.git.ts'
import {
  assertMergedPairStructure,
  normalizeMetaPath,
} from './translation-pairing-merge.structure.ts'

/** A mechanically composed record and the exact merged owner contents it names. */
export interface TranslationPairingMergeResult extends TranslationPairingRecord {
  /** Canonical generated sidecar text. */
  record: string
  /** Clean three-way merge of the English owner. */
  sourceContent: Buffer
  /** Clean three-way merge of the Simplified Chinese owner. */
  zhContent: Buffer
}

/**
 * Compose one generated sidecar from the ancestor, current, and other records.
 *
 * Each input record is already a confirmation of its two owner blobs. The
 * result exists only when Git's default text merge succeeds independently for
 * both languages and the composed documents retain the pairing structure.
 *
 * @param root - Repository root containing the referenced Git objects.
 * @param metaPath - Repository-relative sidecar path.
 * @param ancestorRecord - Common-ancestor sidecar text.
 * @param currentRecord - Current-side sidecar text.
 * @param otherRecord - Other-side sidecar text.
 * @returns The canonical record and exact merged owner contents.
 * @throws Error when the input is not mechanically composable.
 */
export function mergeTranslationPairingRecords(
  root: string,
  metaPath: string,
  ancestorRecord: string,
  currentRecord: string,
  otherRecord: string,
  isTranslationPairSource: (sourcePath: string) => boolean,
): TranslationPairingMergeResult {
  const normalizedMeta = normalizeMetaPath(root, metaPath)
  if (!isTranslationScopeFile(normalizedMeta)) {
    throw new Error(`${normalizedMeta} is outside the active bilingual documentation corpus`)
  }
  const paths = translationPairPathsFromMeta(normalizedMeta)
  if (!isTranslationPairSource(paths.source)) {
    throw new Error(`${normalizedMeta} is excluded from the active bilingual documentation corpus`)
  }
  assertDefaultTextMerge(root, paths)
  const ancestor = loadRecordOwners(root, 'ancestor', ancestorRecord, paths)
  const current = loadRecordOwners(root, 'current', currentRecord, paths)
  const other = loadRecordOwners(root, 'other', otherRecord, paths)
  const sourceContent = mergeBlobTriplet(root, paths.source, ancestor.source, current.source, other.source)
  const zhContent = mergeBlobTriplet(root, paths.zh, ancestor.zh, current.zh, other.zh)
  assertMergedPairStructure(root, paths, sourceContent, zhContent, isTranslationPairSource)
  const sourceHash = storeGitBlob(root, sourceContent)
  const zhHash = storeGitBlob(root, zhContent)
  return {
    record: renderTranslationPairingRecord(paths, { sourceHash, zhHash }),
    sourceContent,
    sourceHash,
    zhContent,
    zhHash,
  }
}

/** Read the repository manifest and return its active bilingual-source predicate. */
export function repositoryTranslationPairSource(root: string): (sourcePath: string) => boolean {
  const path = 'scripts/translation-pairing.manifest.json'
  const content = readGitIndexBlob(root, path)?.content ?? readFileSync(join(root, path))
  const manifest = parseTranslationPairingManifest(
    content.toString('utf8'),
  )
  return translationPairSourcePredicate(manifest)
}
