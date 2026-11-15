/** Regression cases for translation pairing snapshot storage in Git objects and the index. */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  gitBlobHash,
  gitIndexPaths,
  readGitIndexBlob,
  storeGitBlob,
} from './translation-pairing-git.ts'

function gitSupportsObjectFormat(format: 'sha256'): boolean {
  const root = mkdtempSync(join(tmpdir(), 'dsh-git-object-format-'))
  try {
    return spawnSync('git', ['init', '--quiet', `--object-format=${format}`, root], {
      stdio: 'ignore',
    }).status === 0
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const supportsSha256ObjectFormat = gitSupportsObjectFormat('sha256')

describe('translation pairing snapshots', () => {
  it('stores exact uncommitted bytes for later recovery by object ID', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-translation-pairing-'))
    try {
      execFileSync('git', ['init', '--quiet', root], {
        env: { ...process.env, GIT_DEFAULT_HASH: 'sha1' },
      })
      const content = Buffer.from([0x75, 0x6e, 0x63, 0x6f, 0x6d, 0x6d, 0x69, 0x74, 0x74, 0x65, 0x64, 0x0a, 0xff])

      const objectId = storeGitBlob(root, content)

      expect(objectId).toBe(gitBlobHash(content))
      expect(execFileSync('git', [
        '-C', root, 'rev-parse', `refs/dsh/translation-pairing/snapshots/${objectId}`,
      ], { encoding: 'utf8' }).trim()).toBe(objectId)
      execFileSync('git', ['-C', root, 'gc', '--prune=now'])
      expect(execFileSync('git', ['-C', root, 'cat-file', '-p', objectId])).toEqual(content)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails before a sidecar can reference an unavailable object', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-translation-pairing-'))
    try {
      expect(() => storeGitBlob(root, Buffer.from('snapshot'))).toThrow('git hash-object -w --stdin failed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails clearly when Git cannot be started', () => {
    const previousPath = process.env.PATH
    try {
      process.env.PATH = ''
      expect(() => storeGitBlob('.', Buffer.from('snapshot'))).toThrow('git hash-object -w --stdin failed')
    } finally {
      process.env.PATH = previousPath
    }
  })

  it('reads staged bytes independently of the working tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-translation-pairing-index-'))
    try {
      execFileSync('git', ['init', '--quiet', root], {
        env: { ...process.env, GIT_DEFAULT_HASH: 'sha1' },
      })
      execFileSync('git', ['-C', root, 'config', 'user.email', 'pairing@example.test'])
      execFileSync('git', ['-C', root, 'config', 'user.name', 'Pairing Test'])
      writeFileSync(join(root, 'owner.md'), 'staged')
      execFileSync('git', ['-C', root, 'add', 'owner.md'])
      writeFileSync(join(root, 'owner.md'), 'unstaged')

      const indexed = readGitIndexBlob(root, 'owner.md')

      expect(indexed?.content.toString('utf8')).toBe('staged')
      expect(indexed?.objectId).toBe(gitBlobHash(Buffer.from('staged')))
      expect(readGitIndexBlob(root, 'absent.md')).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists exact index files without treating a directory prefix as one entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-translation-pairing-index-'))
    try {
      execFileSync('git', ['init', '--quiet', root], {
        env: { ...process.env, GIT_DEFAULT_HASH: 'sha1' },
      })
      mkdirSync(join(root, 'docs'), { recursive: true })
      writeFileSync(join(root, 'docs/reference.md'), '# Reference\n')
      writeFileSync(join(root, 'docs/reference.zh.md'), '# 参考\n')
      execFileSync('git', ['-C', root, 'add', 'docs'])

      expect(gitIndexPaths(root)).toEqual(new Set([
        'docs/reference.md',
        'docs/reference.zh.md',
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(!supportsSha256ObjectFormat)('rejects an object format that pairing records cannot represent', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-translation-pairing-'))
    try {
      execFileSync('git', ['init', '--quiet', '--object-format=sha256', root])
      expect(() => storeGitBlob(root, Buffer.from('snapshot'))).toThrow('returned unexpected object ID')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
