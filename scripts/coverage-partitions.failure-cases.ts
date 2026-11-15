/** How the coordinator reports partition failures and finished coverage. */

import { access, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CoveragePartitionCoordinator,
  type CoverageCommand,
} from './coverage-partitions.ts'
import { passed, temporaryRoot, writeBlob } from './coverage-partitions.fixtures-cases.ts'

describe('coverage partition coordinator', () => {
  it('rejects an empty partition assignment before spawning any command', async () => {
    const root = await temporaryRoot()
    const runCommand = vi.fn()
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 3,
      pnpmEntrypoint: '/pnpm.cjs',
      // One file for three partitions leaves two buckets empty; an empty
      // bucket would make Vitest run the whole suite.
      files: ['a.spec.ts'],
      runCommand,
    })

    await expect(coordinator.run()).rejects.toThrow('partition 2/3 has no files')
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('merges normal test failures and returns their failed status', async () => {
    const root = await temporaryRoot()
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      await writeBlob(command)
      return command.label === 'partition 2/2'
        ? { exitCode: 1, signalCode: null, outputTail: 'specific Vitest failure' }
        : passed
    })
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      files: ['a.spec.ts', 'b.spec.ts'],
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(1)
    expect(reported).toHaveBeenCalledWith('coverage-partitions: FAIL partition 2/2 (exit 1)')
    expect(reported).toHaveBeenCalledWith(
      'coverage-partitions: output tail for partition 2/2:\nspecific Vitest failure',
    )
    expect(runCommand).toHaveBeenCalledTimes(3)
  })

  it('rejects a missing partition blob before merge', async () => {
    const root = await temporaryRoot()
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      if (command.label !== 'partition 2/2') await writeBlob(command)
      return passed
    })
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      files: ['a.spec.ts', 'b.spec.ts'],
      runCommand,
    })

    await expect(coordinator.run()).rejects.toThrow('coverage partitions produced')
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('reports signal termination before missing-blob validation', async () => {
    const root = await temporaryRoot()
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      if (command.label === 'partition 1/2') await writeBlob(command)
      return command.label === 'partition 2/2'
        ? { exitCode: null, signalCode: 'SIGTERM' as const }
        : passed
    })
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      files: ['a.spec.ts', 'b.spec.ts'],
      runCommand,
    })

    await expect(coordinator.run()).rejects.toThrow('coverage partitions produced')
    expect(reported).toHaveBeenCalledWith('coverage-partitions: FAIL partition 2/2 (signal SIGTERM)')
  })

  it('waits for every partition after one spawn failure', async () => {
    const root = await temporaryRoot()
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let secondFinished = false
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      await writeBlob(command)
      if (command.label === 'partition 1/2') {
        return { exitCode: null, signalCode: null, error: 'spawn unavailable' }
      }
      if (command.label === 'partition 2/2') secondFinished = true
      return passed
    })
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      files: ['a.spec.ts', 'b.spec.ts'],
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(1)
    expect(reported).toHaveBeenCalledWith('coverage-partitions: FAIL partition 1/2 (spawn unavailable)')
    expect(secondFinished).toBe(true)
    expect(runCommand).toHaveBeenCalledTimes(3)
  })

  it('unlinks a link-shaped coverage path without touching its target', async () => {
    const root = await temporaryRoot()
    const target = await temporaryRoot()
    const marker = join(target, 'marker.txt')
    await writeFile(marker, 'owned elsewhere')
    await symlink(target, join(root, 'coverage'), process.platform === 'win32' ? 'junction' : 'dir')
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      await writeBlob(command)
      return passed
    })
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      files: ['a.spec.ts', 'b.spec.ts'],
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(0)
    await expect(access(marker)).resolves.toBeUndefined()
  })
})
