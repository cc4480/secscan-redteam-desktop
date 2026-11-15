/**
 * Repository paths, spawned CLIs, and scratch-config helpers shared by the
 * Oxlint executable-contract cases.
 */

import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the repository root this suite drives. */
export const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

/** Absolute path of the Oxlint CLI entry the contract cases spawn. */
export const oxlintCli = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url))

/** Absolute path of the tsx CLI entry used to launch repository scripts. */
export const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))

/**
 * Narrows a parsed JSON value to a string-keyed record.
 * @param value - The parsed value to narrow.
 * @returns True when the value is a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrows a parsed JSON value to an array of unknowns.
 * @param value - The parsed value to narrow.
 * @returns True when the value is an array.
 */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Runs the repository Oxlint wrapper through the tsx CLI.
 * @param args - Arguments forwarded to `scripts/run-oxlint.ts`.
 * @param env - Extra environment variables layered over the inherited ones.
 * @returns The completed child process with captured stdio.
 */
export function runRepositoryOxlint(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [tsxCli, 'scripts/run-oxlint.ts', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
}

/**
 * Runs the Oxlint CLI directly.
 * @param args - Arguments forwarded to the Oxlint CLI.
 * @param env - Extra environment variables layered over the inherited ones.
 * @returns The completed child process with captured stdio.
 */
export function runOxlint(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [oxlintCli, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
}

/**
 * Joins a spawned Oxlint result's streams with normalized path separators.
 * @param result - A completed `runOxlint` result.
 * @returns The combined stdout and stderr.
 */
export function normalizedOutput(result: ReturnType<typeof runOxlint>): string {
  return `${result.stdout}${result.stderr}`.replaceAll('\\', '/')
}

/**
 * Writes a scratch Oxlint config extending the repository config.
 * @param suffix - Unique suffix naming the scratch file.
 * @returns The absolute path of the written config.
 */
export async function writeContractConfig(suffix: string): Promise<string> {
  const path = join(repositoryRoot, `.oxlintrc.contract-${suffix}.json`)
  await writeFile(path, JSON.stringify({ extends: ['./.oxlintrc.json'], ignorePatterns: [] }))
  return path
}
