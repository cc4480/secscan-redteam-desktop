/** Stand-in release members and temporary repository roots shared by the family cases. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, vi } from 'vitest'
import type { ReleaseMember } from './families.ts'

/** Every temporary root this case file created, removed after each test. */
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
export function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

/**
 * Create a temporary repository root the suite removes after the test.
 * @param prefix - the temporary directory name prefix.
 * @returns The absolute root.
 */
export function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/**
 * Write one fixture file, creating its parent directories.
 * @param path - absolute file path.
 * @param content - the file content.
 */
export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
