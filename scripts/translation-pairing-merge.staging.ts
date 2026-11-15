/** Index-conflict resolution and staging for the pairing merge driver. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  gitBlobHash,
  readGitIndexBlob,
  runGit,
} from './translation-pairing-git.ts'
import { translationPairPathsFromMeta } from './translation-pairing-record.ts'
import { mergeTranslationPairingRecords } from './translation-pairing-merge.compose.ts'
import { readGitBlob, runTextMerge } from './translation-pairing-merge.git.ts'

const UNMERGED_ENTRY = /^(\d+) ([0-9a-f]+) ([123])\t([\s\S]+)$/

interface UnmergedStages {
  ancestor?: string
  current?: string
  other?: string
}

function unmergedSidecars(root: string): Map<string, UnmergedStages> {
  const output = runGit(root, ['ls-files', '--unmerged', '-z'], 'listing unresolved merge entries').toString('utf8')
  const records = new Map<string, UnmergedStages>()
  for (const entry of output.split('\0')) {
    if (entry === '') continue
    const match = UNMERGED_ENTRY.exec(entry)
    if (!match?.[2] || !match[3] || match[4] === undefined) {
      throw new Error(`git ls-files returned a malformed unmerged entry: ${JSON.stringify(entry)}`)
    }
    const path = match[4]
    if (!path.endsWith('.i18n.yaml')) continue
    const stages = records.get(path) ?? {}
    const field = match[3] === '1' ? 'ancestor' : match[3] === '2' ? 'current' : 'other'
    stages[field] = match[2]
    records.set(path, stages)
  }
  return records
}

function assertUneditedSidecar(
  root: string,
  metaPath: string,
  ancestorRecord: string,
  currentRecord: string,
  otherRecord: string,
): void {
  const worktreeRecord = readFileSync(join(root, metaPath), 'utf8')
  if (worktreeRecord === currentRecord || worktreeRecord === otherRecord) return
  const textMerge = runTextMerge(root, metaPath, ancestorRecord, currentRecord, otherRecord)
  if (textMerge.status === 0 && textMerge.output.toString('utf8') === worktreeRecord) return
  const stageDataLines = [currentRecord, otherRecord]
    .flatMap(record => record.split(/\r?\n/))
    .filter(line => line !== '' && !line.startsWith('#'))
  const hasUneditedConflict = worktreeRecord.includes('<<<<<<<')
    && worktreeRecord.includes('=======')
    && worktreeRecord.includes('>>>>>>>')
    && stageDataLines.every(line => worktreeRecord.includes(line))
  if (!hasUneditedConflict) {
    throw new Error(`${metaPath} has edited conflict content; refusing to overwrite manual work`)
  }
}

/**
 * Resolve every mechanically composable `.i18n.yaml` conflict in the index.
 *
 * The command first proves that Git's already-staged owner merges match the
 * independently composed contents, then writes and stages all sidecars as one
 * batch. Other conflicts remain untouched; after staging the safe records, an
 * aggregate error reports any pairing conflicts that still need manual work.
 *
 * @param root - Repository root with an in-progress merge-like operation.
 * @returns Repository-relative sidecar paths resolved and staged.
 */
export function resolveTranslationPairingConflicts(
  root: string,
  isTranslationPairSource: (sourcePath: string) => boolean,
): string[] {
  const resolutions: { path: string; record: string }[] = []
  const failures: { path: string; reason: string }[] = []
  for (const [metaPath, stages] of [...unmergedSidecars(root)].sort(([left], [right]) => left.localeCompare(right))) {
    try {
      if (stages.ancestor === undefined || stages.current === undefined || stages.other === undefined) {
        throw new Error('is an add/delete or incomplete-stage conflict and requires manual resolution')
      }
      const ancestorRecord = readGitBlob(root, stages.ancestor, `ancestor ${metaPath}`).toString('utf8')
      const currentRecord = readGitBlob(root, stages.current, `current ${metaPath}`).toString('utf8')
      const otherRecord = readGitBlob(root, stages.other, `other ${metaPath}`).toString('utf8')
      assertUneditedSidecar(root, metaPath, ancestorRecord, currentRecord, otherRecord)
      const result = mergeTranslationPairingRecords(
        root,
        metaPath,
        ancestorRecord,
        currentRecord,
        otherRecord,
        isTranslationPairSource,
      )
      const paths = translationPairPathsFromMeta(metaPath)
      if (readGitIndexBlob(root, paths.source)?.objectId !== result.sourceHash) {
        throw new Error(`${paths.source} staged merge does not match the pairing driver's clean merge`)
      }
      if (readGitIndexBlob(root, paths.zh)?.objectId !== result.zhHash) {
        throw new Error(`${paths.zh} staged merge does not match the pairing driver's clean merge`)
      }
      for (const [path, expected] of [[paths.source, result.sourceHash], [paths.zh, result.zhHash]] as const) {
        if (gitBlobHash(readFileSync(join(root, path))) !== expected) {
          throw new Error(`${path} has unstaged content; refusing to confirm bytes outside the merge result`)
        }
      }
      resolutions.push({ path: metaPath, record: result.record })
    } catch (error) {
      failures.push({ path: metaPath, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const resolution of resolutions) writeFileSync(join(root, resolution.path), resolution.record)
  if (resolutions.length > 0) {
    runGit(root, ['add', '--', ...resolutions.map(resolution => resolution.path)], 'staging resolved pairing records')
  }
  if (failures.length > 0) {
    const resolved = resolutions.length === 0
      ? ''
      : `resolved and staged ${resolutions.map(resolution => resolution.path).join(', ')}; `
    throw new Error(
      `${resolved}left ${String(failures.length)} pairing conflict(s) unresolved:\n`
      + failures.map(failure => `- ${failure.path}: ${failure.reason}`).join('\n'),
    )
  }
  return resolutions.map(resolution => resolution.path)
}
