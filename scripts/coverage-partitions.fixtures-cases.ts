/** Scratch roots, blob writers, and coordinator helpers shared by the partition cases. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, vi } from 'vitest'
import {
  CoveragePartitionCoordinator,
  type CoverageCommand,
  type CoverageCommandResult,
  type CoveragePartitionCoordinatorOptions,
} from './coverage-partitions.ts'

/** A partition command that exited successfully without a signal. */
export const passed: CoverageCommandResult = { exitCode: 0, signalCode: null }

/** Every temporary root created by this file, removed after each test. */
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Write the blob a partition command would have left behind. */
export async function writeBlob(command: CoverageCommand): Promise<void> {
  if (command.blobPath === undefined) return
  await mkdir(dirname(command.blobPath), { recursive: true })
  await writeFile(command.blobPath, '{}')
}

/** Create a temporary root that the suite removes after the test. */
export async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-coverage-partitions-'))
  roots.push(root)
  return root
}

/** Write a Vitest results cache under a temporary root. */
export async function writeVitestCache(
  root: string,
  entries: Array<[string, { duration: number }]>,
): Promise<void> {
  const cacheDir = join(root, 'node_modules/.vite/vitest/cache-hash')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, 'results.json'), JSON.stringify({ version: '4.1.8', results: entries }))
}

/** Run the coordinator and capture every partition config's source. */
export async function runCoordinatorReadingConfigs(
  root: string,
  options: Omit<CoveragePartitionCoordinatorOptions, 'root' | 'pnpmEntrypoint' | 'runCommand'>,
): Promise<Map<string, string>> {
  const configContents = new Map<string, string>()
  const runCommand = vi.fn(async (command: CoverageCommand) => {
    const configArgument = command.args.find(argument => argument.startsWith('--config='))
    if (configArgument !== undefined) {
      configContents.set(command.label, await readFile(join(root, configArgument.slice('--config='.length)), 'utf8'))
    }
    await writeBlob(command)
    return passed
  })
  const coordinator = new CoveragePartitionCoordinator({
    root,
    pnpmEntrypoint: '/pnpm.cjs',
    runCommand,
    ...options,
  })
  await expect(coordinator.run()).resolves.toBe(0)
  return configContents
}

/** Record every command the coordinator runs and report success for each. */
export function successfulCommandRecorder(commands: CoverageCommand[]) {
  return vi.fn(async (command: CoverageCommand) => {
    commands.push(command)
    await writeBlob(command)
    return passed
  })
}
