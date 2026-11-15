/**
 * Git plumbing for `scripts/gen-translation-brief.ts`: recorded blob lookup and
 * the temporary-file diff that turns two texts into their unified diff.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Repository root, one directory above this module. */
export const root = resolve(import.meta.dirname, '..')

/** Recorded hashes of one consistency record: basename → blob hash. */
export function parseMeta(content: string): Map<string, string> | undefined {
  const out = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = /^([^:#]+\.md): ([0-9a-f]{40})$/.exec(line)
    if (!match?.[1] || !match[2]) return undefined
    out.set(match[1], match[2])
  }
  return out
}

function git(args: string[], allowedExitCodes: number[] = [0]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (result.error) throw result.error
  if (!allowedExitCodes.includes(result.status ?? -1)) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

/** Read the text of one recorded blob. */
export function blobText(hash: string): string {
  return git(['cat-file', '-p', hash])
}

/** Unified diff between two texts, headers stripped, via `git diff --no-index`. */
export function diffTexts(before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'translation-brief-'))
  try {
    writeFileSync(join(dir, 'last-confirmed.md'), before)
    writeFileSync(join(dir, 'current.md'), after)
    const raw = git(['diff', '--no-index', '--unified=2', join(dir, 'last-confirmed.md'), join(dir, 'current.md')], [0, 1])
    return raw.split('\n')
      .filter(line => !line.startsWith('diff --git') && !line.startsWith('index ') && !line.startsWith('--- ') && !line.startsWith('+++ '))
      .join('\n')
      .trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
