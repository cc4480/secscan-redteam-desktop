/** Scratch Git repositories and recorded baselines shared by the unknown-cast cases. */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'
import { countUnknownCasts, scanUnknownCasts } from './verify-no-unknown-casts.ts'

/** Baseline path, relative to a fixture root. */
export const baselinePath = 'scripts/no-unknown-casts.baseline.json'

/** Tracked source path the inventory cases mutate. */
export const sourcePath = 'packages/example/src/index.ts'

/** The single assertion to unknown that a fixture records as its baseline. */
export const assertion = 'const result = value as unknown\n'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Writes a file with its parent directory created.
 * @param root - fixture root that receives the file.
 * @param file - repository-relative destination path.
 * @param contents - file contents.
 * @returns nothing.
 */
export function write(root: string, file: string, contents: string): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

/**
 * Runs Git inside a fixture, failing the case when Git exits non-zero.
 * @param root - fixture repository root.
 * @param args - Git arguments.
 * @returns nothing.
 */
export function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' })
}

/**
 * Creates a fresh Git repository holding one tracked seed per source area.
 * @returns the absolute fixture root, cleaned up after the case.
 */
export function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-unknown-casts-'))
  roots.push(root)
  git(root, 'init', '--quiet')
  for (const area of ['packages', 'apps', 'scripts', 'website']) {
    write(root, `${area}/seed.ts`, 'export {}\n')
  }
  write(root, baselinePath, '{}\n')
  git(root, 'add', '.')
  return root
}

/**
 * Records the current inventory as a fixture's baseline.
 * @param root - fixture repository root.
 * @returns the baseline text written to disk.
 */
export function recordBaseline(root: string): string {
  const text = `${JSON.stringify(countUnknownCasts(scanUnknownCasts(root)), null, 2)}\n`
  write(root, baselinePath, text)
  return text
}
