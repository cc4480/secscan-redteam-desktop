/** Git blob, attribute, and three-way text-merge primitives for the pairing merge driver. */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GIT_COMMAND_MAX_BUFFER,
  gitBlobHash,
  runGit,
} from './translation-pairing-git.ts'
import {
  parseTranslationPairingRecord,
  type TranslationPairPaths,
} from './translation-pairing-record.ts'

/**
 * Read one Git blob and verify that the sidecar's hash names those exact bytes.
 *
 * @param root - Repository root holding the object.
 * @param objectId - Expected SHA-1 git blob hash.
 * @param owner - Human-readable label for the failure message.
 * @returns The blob content.
 * @throws Error when the object's content does not hash to `objectId`.
 */
export function readGitBlob(root: string, objectId: string, owner: string): Buffer {
  const content = runGit(root, ['cat-file', 'blob', objectId], `reading ${owner} blob ${objectId}`)
  if (gitBlobHash(content) !== objectId) {
    throw new Error(`${owner} record names ${objectId}, which is not its SHA-1 git blob hash`)
  }
  return content
}

function readMergeDefault(root: string): string | undefined {
  const result = spawnSync('git', ['-C', root, 'config', '--get', 'merge.default'], {
    maxBuffer: GIT_COMMAND_MAX_BUFFER,
  })
  if (result.error) {
    throw new Error(`reading merge.default failed: ${result.error.message}`, { cause: result.error })
  }
  if (result.status === 1) return undefined
  if (result.status !== 0) {
    throw new Error(
      `reading merge.default failed with status ${String(result.status)}: ${result.stderr.toString('utf8').trim()}`,
    )
  }
  return result.stdout.toString('utf8').trim()
}

/**
 * Prove both owners resolve to Git's default text merge and no other driver.
 *
 * @param root - Repository root holding the merge attributes.
 * @param paths - The pairing record's owner paths.
 * @throws Error when an owner selects a merge driver other than the default text one.
 */
export function assertDefaultTextMerge(root: string, paths: TranslationPairPaths): void {
  const output = runGit(
    root,
    ['check-attr', '-z', 'merge', '--', paths.source, paths.zh],
    'checking bilingual owner merge attributes',
  ).toString('utf8')
  const fields = output.split('\0')
  fields.pop()
  let mergeDefault: string | undefined
  for (let index = 0; index < fields.length; index += 3) {
    const path = fields[index]
    const value = fields[index + 2]
    if (path === undefined || value === undefined) {
      throw new Error('git check-attr returned a malformed result')
    }
    if (!['unspecified', 'set', 'text'].includes(value)) {
      throw new Error(`${path} uses merge=${value}; the pairing driver only composes Git's default text merge`)
    }
    if (value === 'unspecified') {
      mergeDefault ??= readMergeDefault(root)
      if (mergeDefault !== undefined && mergeDefault !== 'text') {
        throw new Error(
          `${path} inherits merge.default=${mergeDefault}; the pairing driver only composes Git's default text merge`,
        )
      }
    }
  }
}

/**
 * Run Git's three-way text merge over three scratch copies of one owner.
 *
 * @param root - Repository root the merge runs inside.
 * @param label - Owner label used as the conflict-marker base name.
 * @param ancestor - Common-ancestor content.
 * @param current - Current-side content.
 * @param other - Other-side content.
 * @returns The merge stdout and Git's exit status.
 * @throws Error when the merge process itself cannot run.
 */
export function runTextMerge(
  root: string,
  label: string,
  ancestor: Buffer | string,
  current: Buffer | string,
  other: Buffer | string,
): { output: Buffer; status: number | null } {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-translation-pairing-merge-'))
  try {
    const ancestorPath = join(temporary, 'ancestor')
    const currentPath = join(temporary, 'current')
    const otherPath = join(temporary, 'other')
    writeFileSync(ancestorPath, ancestor)
    writeFileSync(currentPath, current)
    writeFileSync(otherPath, other)
    const result = spawnSync('git', [
      '-C', root,
      'merge-file', '-p',
      '-L', `${label}:current`,
      '-L', `${label}:ancestor`,
      '-L', `${label}:other`,
      currentPath, ancestorPath, otherPath,
    ], { maxBuffer: GIT_COMMAND_MAX_BUFFER })
    if (result.error) {
      throw new Error(`merging ${label} failed: ${result.error.message}`, { cause: result.error })
    }
    return { output: result.stdout, status: result.status }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

/**
 * Merge one owner's three blobs and fail closed on any content conflict.
 *
 * @param root - Repository root the merge runs inside.
 * @param owner - Owner label for conflict markers and failure messages.
 * @param ancestor - Common-ancestor blob.
 * @param current - Current-side blob.
 * @param other - Other-side blob.
 * @returns The cleanly merged owner content.
 * @throws Error when the merge reports conflicts or cannot run.
 */
export function mergeBlobTriplet(
  root: string,
  owner: string,
  ancestor: Buffer,
  current: Buffer,
  other: Buffer,
): Buffer {
  const result = runTextMerge(root, owner, ancestor, current, other)
  if (result.status !== 0) {
    const kind = result.status !== null && result.status > 0 && result.status <= 127
      ? 'has content conflicts'
      : `failed with status ${String(result.status)}`
    throw new Error(`${owner} ${kind}`)
  }
  return result.output
}

/**
 * Parse one sidecar record and load the two owner blobs it names.
 *
 * @param root - Repository root holding the referenced objects.
 * @param label - Ancestor/current/other label for failure messages.
 * @param content - Sidecar record text.
 * @param paths - The pairing record's owner paths.
 * @returns Both owner contents.
 * @throws Error when the record is not a valid two-hash pairing record.
 */
export function loadRecordOwners(
  root: string,
  label: string,
  content: string,
  paths: TranslationPairPaths,
): { source: Buffer; zh: Buffer } {
  const record = parseTranslationPairingRecord(content, paths)
  if (record === undefined) throw new Error(`${label} ${paths.meta} is not a valid two-hash pairing record`)
  return {
    source: readGitBlob(root, record.sourceHash, `${label} ${paths.source}`),
    zh: readGitBlob(root, record.zhHash, `${label} ${paths.zh}`),
  }
}
