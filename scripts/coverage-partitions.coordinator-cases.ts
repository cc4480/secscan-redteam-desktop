/** How the coordinator wires each partition command and the merged report. */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  COVERAGE_PARTITION_MODE_ENV,
  COVERAGE_PARTITIONS_ENV,
  CoveragePartitionCoordinator,
  type CoverageCommand,
} from './coverage-partitions.ts'
import {
  passed,
  runCoordinatorReadingConfigs,
  successfulCommandRecorder,
  temporaryRoot,
  writeBlob,
} from './coverage-partitions.fixtures-cases.ts'

describe('coverage partition coordinator', () => {
  const weightedFiles = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts']
  const weightedDurations = new Map([
    ['a.spec.ts', 100],
    ['b.spec.ts', 50],
    ['c.spec.ts', 10],
  ])
  const weightedProjects = new Map([
    ['a.spec.ts', 'thread-safe'],
    ['b.spec.ts', 'process-bound'],
    ['c.spec.ts', 'process-bound'],
  ])

  it('passes the canonicalizing reporter to every partition', async () => {
    const root = await temporaryRoot()
    const commands: CoverageCommand[] = []
    const runCommand = successfulCommandRecorder(commands)
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      files: ['a.spec.ts', 'b.spec.ts'],
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(0)

    // The coordinator passes a root-relative argument and runs every child with
    // the repository root as its working directory, so the argument must name
    // the reporter that sits beside this spec. Whether that reporter runs
    // before the blob write is Vitest's reporter ordering, not a command the
    // coordinator builds.
    const specDirectory = dirname(fileURLToPath(import.meta.url))
    const reporterPath = join(specDirectory, 'coverage-canonical-locations.ts')
    for (const command of commands.slice(0, 2)) {
      const argument = command.args.find(candidate => candidate.startsWith('--reporter=') && candidate.endsWith('coverage-canonical-locations.ts'))
      if (argument === undefined) throw new Error(`${command.label} does not wire the coverage canonicalizer`)
      expect(resolve(specDirectory, '..', argument.slice('--reporter='.length))).toBe(reporterPath)
    }
  })

  it('runs every single-worker partition before one merged threshold check', async () => {
    const root = await temporaryRoot()
    const commands: CoverageCommand[] = []
    const partitionConfigs: string[] = []
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      commands.push(command)
      const configArgument = command.args.find(argument => argument.startsWith('--config='))
      if (configArgument !== undefined) {
        partitionConfigs.push(await readFile(join(root, configArgument.slice('--config='.length)), 'utf8'))
      }
      await writeBlob(command)
      return passed
    })
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 3,
      pnpmEntrypoint: '/pnpm.cjs',
      vitestArgs: ['--testTimeout=30000'],
      files: ['a.spec.ts', 'b.spec.ts', 'c.spec.ts'],
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(0)

    expect(commands.map(command => command.label)).toEqual([
      'partition 1/3',
      'partition 2/3',
      'partition 3/3',
      'merged coverage report',
    ])
    for (const command of commands.slice(0, 3)) {
      expect(command.command).toBe(process.execPath)
      expect(command.args[0]).toBe('/pnpm.cjs')
      expect(command.args).toEqual(expect.arrayContaining([
        '--coverage',
        '--coverage.reportOnFailure',
        '--maxWorkers=1',
        '--reporter=default',
        '--reporter=blob',
        '--reporter=json',
        '--testTimeout=30000',
      ]))
      expect(command.args).not.toContain('--shard=1/3')
      expect(command.args.some(argument => argument.startsWith('--config='))).toBe(true)
      expect(command.env).toEqual({
        [COVERAGE_PARTITIONS_ENV]: undefined,
        [COVERAGE_PARTITION_MODE_ENV]: '1',
      })
    }
    // The partition file list travels in a temporary config, not on the
    // command line (which exceeds the Windows CreateProcess limit).
    expect(partitionConfigs).toHaveLength(3)
    const allConfigs = partitionConfigs.join('\n')
    expect(allConfigs).toContain('a.spec.ts')
    expect(allConfigs).toContain('b.spec.ts')
    expect(allConfigs).toContain('c.spec.ts')
    for (const source of partitionConfigs) {
      expect(source).toContain("from '../../vitest.config.ts'")
    }
    const mergeCommand = commands[3]
    if (mergeCommand === undefined) throw new Error('coverage merge command was not observed')
    expect(mergeCommand.args).toContain('--coverage')
    expect(mergeCommand.args.some(argument => argument.startsWith('--merge-reports='))).toBe(true)
    expect(mergeCommand.env).toEqual({
      [COVERAGE_PARTITIONS_ENV]: undefined,
      [COVERAGE_PARTITION_MODE_ENV]: undefined,
    })
  })

  it('starts the heaviest partition first for fail-fast', async () => {
    const root = await temporaryRoot()
    const configContents = await runCoordinatorReadingConfigs(root, {
      partitions: 2,
      files: weightedFiles,
      weights: weightedDurations,
    })
    // LPT: p1=[a] sum 100, p2=[b,c] sum 60; sorted heaviest-first makes
    // partition 1/2 the heavy one, so its config names a.spec.ts.
    expect(configContents.get('partition 1/2')).toContain('a.spec.ts')
    expect(configContents.get('partition 1/2')).not.toContain('b.spec.ts')
  })

  it('gives each project only its own files in the partition config', async () => {
    const root = await temporaryRoot()
    const configContents = await runCoordinatorReadingConfigs(root, {
      partitions: 2,
      files: weightedFiles,
      weights: weightedDurations,
      projectOf: weightedProjects,
    })
    const allConfigs = [...configContents.values()].join('\n')
    // The process-bound project must not receive the thread-safe file and
    // vice versa, or plain files would run twice.
    expect(allConfigs).toContain("include: project.test.name === 'process-bound' ?")
    expect(allConfigs).not.toContain('"a.spec.ts","b.spec.ts","c.spec.ts"')
  })

  it('runs a native pnpm entrypoint directly', async () => {
    const root = await temporaryRoot()
    const commands: CoverageCommand[] = []
    const runCommand = successfulCommandRecorder(commands)
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/tools/pnpm',
      files: ['a.spec.ts', 'b.spec.ts'],
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(0)
    expect(commands).toHaveLength(3)
    for (const command of commands) {
      expect(command.command).toBe('/tools/pnpm')
      expect(command.args[0]).toBe('exec')
    }
  })
})
