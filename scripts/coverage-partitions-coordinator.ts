/** Run instrumented coverage partitions and merge their blobs once. */
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import {
  commandFailed,
  commandFailureReason,
  type CoverageCommand,
  type CoverageCommandRunner,
  removeOwnedTree,
  runCoverageCommand,
} from './coverage-partitions-commands.ts'
import { CANONICAL_LOCATIONS_REPORTER, partitionConfigSource } from './coverage-partitions-config.ts'
import { COVERAGE_PARTITION_MODE_ENV, COVERAGE_PARTITIONS_ENV } from './coverage-partitions-environment.ts'
import {
  collectInstrumentedFiles,
  collectPartitionDurations,
  readFileDurations,
  writeFileDurations,
} from './coverage-partitions-inventory.ts'
import { assignWeightedPartitions, partitionWeight } from './coverage-partitions-scheduling.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Construction inputs for {@link CoveragePartitionCoordinator}. */
export interface CoveragePartitionCoordinatorOptions {
  /** Repository root that owns coverage output. */
  root: string
  /** Number of concurrent single-worker Vitest processes. */
  partitions: number
  /** pnpm JavaScript or executable entrypoint from `npm_execpath`. */
  pnpmEntrypoint: string
  /** Additional arguments shared by every partition. */
  vitestArgs?: string[]
  /** Child executor, injectable for scheduler tests. */
  runCommand?: CoverageCommandRunner
  /** Instrumented inventory; collected from the workspace when absent or empty. */
  files?: readonly string[]
  /** Recorded durations paired with `files`; read from persistence when absent. */
  weights?: ReadonlyMap<string, number>
  /** Project ownership paired with `files`; collected from `vitest list` when absent. */
  projectOf?: ReadonlyMap<string, string>
}

/** Run instrumented partitions, validate their blobs, and merge once. */
export class CoveragePartitionCoordinator {
  private readonly root: string
  private readonly partitions: number
  private readonly pnpmEntrypoint: string
  private readonly vitestArgs: string[]
  private readonly runCommand: CoverageCommandRunner
  private readonly files: readonly string[]
  private readonly weights: ReadonlyMap<string, number> | undefined
  private projectOf = new Map<string, string>()
  private readonly temporaryRoot: string
  private readonly blobsRoot: string

  /** Create a coordinator from validated process-independent inputs. */
  public constructor(options: CoveragePartitionCoordinatorOptions) {
    if (!Number.isSafeInteger(options.partitions) || options.partitions < 2) {
      throw new Error(`coverage partitions must be an integer greater than 1, got ${String(options.partitions)}.`)
    }
    this.root = options.root
    this.partitions = options.partitions
    this.pnpmEntrypoint = options.pnpmEntrypoint
    this.vitestArgs = options.vitestArgs ?? []
    this.runCommand = options.runCommand ?? runCoverageCommand
    this.files = options.files ?? []
    this.weights = options.weights
    this.projectOf = new Map(options.projectOf ?? [])
    this.temporaryRoot = join(this.root, 'coverage', '.partitioned')
    this.blobsRoot = join(this.temporaryRoot, 'blobs')
  }

  /**
   * Run every partition before one merged threshold check.
   * @returns zero only when every partition and the merge command succeed.
   */
  public async run(): Promise<number> {
    await removeOwnedTree(join(this.root, 'coverage'))
    await mkdir(this.blobsRoot, { recursive: true })

    try {
      const assignments = await this.assignFiles()
      this.assertNonEmptyAssignments(assignments)
      const configPaths = await this.writePartitionConfigs(assignments)
      const commands = assignments.map((_, index) => this.partitionCommand(index + 1, configPaths[index] ?? ''))
      const results = await Promise.all(commands.map(async (command) => {
        console.log(`coverage-partitions: start ${command.label}`)
        const result = await this.runCommand(command)
        if (commandFailed(result)) {
          console.error(`coverage-partitions: FAIL ${command.label} (${commandFailureReason(result)})`)
          if (result.outputTail !== undefined && result.outputTail !== '') {
            console.error(`coverage-partitions: output tail for ${command.label}:\n${result.outputTail}`)
          }
        }
        return result
      }))
      // Persist durations before blob validation: a missing blob aborts the
      // run, but the completed partitions' timings are still worth keeping.
      this.persistDurations(this.partitions)
      await this.assertCompleteBlobSet(commands)

      const mergeCommand = this.mergeCommand()
      console.log(`coverage-partitions: start ${mergeCommand.label}`)
      const mergeResult = await this.runCommand(mergeCommand)
      return results.some(commandFailed) || commandFailed(mergeResult) ? 1 : 0
    } finally {
      await removeOwnedTree(this.temporaryRoot)
    }
  }

  /**
   * Refuse an empty partition: Vitest treats a config with no matching files
   * as "run everything", so an empty bucket would silently execute the whole
   * suite once per empty partition.
   */
  private assertNonEmptyAssignments(assignments: readonly (readonly string[])[]): void {
    const empty = assignments.findIndex(files => files.length === 0)
    if (empty >= 0) {
      throw new Error(
        `coverage partitions: partition ${empty + 1}/${this.partitions} has no files; `
        + 'the instrumented inventory is empty or smaller than the partition count.',
      )
    }
  }

  /** Persist measured per-file durations so the next run can weight by them. */
  private persistDurations(partitionCount: number): void {
    const reportFiles = Array.from(
      { length: partitionCount },
      (_, index) => join(this.temporaryRoot, `partition-${index + 1}.report.json`),
    )
    const currentFiles = this.projectOf.size > 0 ? [...this.projectOf.keys()] : undefined
    writeFileDurations(this.root, collectPartitionDurations(reportFiles, this.root), currentFiles)
  }

  /**
   * Distribute the instrumented inventory across partitions by recorded
   * duration, heaviest partition first so the longest child starts earliest
   * (fail-fast: its verdict, success or failure, lands before the light
   * children settle). An injected file list skips workspace collection and
   * cache reads (scheduler tests); production collection always runs.
   */
  private async assignFiles(): Promise<string[][]> {
    let files: readonly string[]
    let weights: ReadonlyMap<string, number>
    if (this.files.length > 0) {
      files = this.files
      weights = this.weights ?? new Map()
    } else {
      // Positional filters live after the `--` separator; options and their
      // values (`--testTimeout 5000`) must never be mistaken for filters.
      const separator = this.vitestArgs.indexOf('--')
      const filters = separator >= 0 ? this.vitestArgs.slice(separator + 1) : []
      const inventory = await collectInstrumentedFiles(this.root, this.pnpmEntrypoint, filters)
      files = inventory.files
      this.projectOf = inventory.projectOf
      weights = readFileDurations(this.root)
    }
    const buckets = assignWeightedPartitions(files, weights, this.partitions)
    buckets.sort((left, right) => partitionWeight(right, weights) - partitionWeight(left, weights))
    return buckets
  }

  /**
   * Write one temporary Vitest config per partition whose `include` (top level
   * and per project) is the partition's file list. Passing files on the
   * command line exceeded the Windows CreateProcess limit once a partition
   * held a few hundred paths, so each partition instead points Vitest at a
   * short `--config` path.
   */
  private async writePartitionConfigs(assignments: readonly (readonly string[])[]): Promise<string[]> {
    return await Promise.all(assignments.map(async (files, index) => {
      const configPath = join(this.temporaryRoot, `vitest-partition-${index + 1}.config.ts`)
      await writeFile(configPath, partitionConfigSource(files, this.projectOf), 'utf8')
      return configPath
    }))
  }

  private partitionCommand(index: number, configPath: string): CoverageCommand {
    const blobPath = join(this.blobsRoot, `partition-${index}.json`)
    const reportsDirectory = join(this.temporaryRoot, `coverage-${index}`)
    const jsonReportPath = join(this.temporaryRoot, `partition-${index}.report.json`)
    const invocation = pnpmInvocation([
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--coverage.reportOnFailure',
      '--maxWorkers=1',
      `--config=${this.relativePath(configPath)}`,
      '--reporter=default',
      '--reporter=blob',
      '--reporter=json',
      `--reporter=${CANONICAL_LOCATIONS_REPORTER}`,
      `--outputFile.blob=${this.relativePath(blobPath)}`,
      `--outputFile.json=${this.relativePath(jsonReportPath)}`,
      `--coverage.reportsDirectory=${this.relativePath(reportsDirectory)}`,
      ...this.vitestArgs,
    ], { npm_execpath: this.pnpmEntrypoint })
    return {
      label: `partition ${index}/${this.partitions}`,
      ...invocation,
      env: {
        [COVERAGE_PARTITIONS_ENV]: undefined,
        [COVERAGE_PARTITION_MODE_ENV]: '1',
      },
      cwd: this.root,
      blobPath,
    }
  }

  private mergeCommand(): CoverageCommand {
    const invocation = pnpmInvocation([
      'exec',
      'vitest',
      `--merge-reports=${this.relativePath(this.blobsRoot)}`,
      '--coverage',
    ], { npm_execpath: this.pnpmEntrypoint })
    return {
      label: 'merged coverage report',
      ...invocation,
      env: {
        [COVERAGE_PARTITIONS_ENV]: undefined,
        [COVERAGE_PARTITION_MODE_ENV]: undefined,
      },
      cwd: this.root,
    }
  }

  private relativePath(path: string): string {
    return relative(this.root, path).split(sep).join('/')
  }

  private async assertCompleteBlobSet(commands: CoverageCommand[]): Promise<void> {
    const expected = commands.map((command) => {
      if (command.blobPath === undefined) throw new Error(`${command.label} has no blob path.`)
      return this.relativePath(command.blobPath)
    }).sort()
    const actual = (await readdir(this.blobsRoot))
      .map(name => this.relativePath(join(this.blobsRoot, name)))
      .sort()
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
      throw new Error(`coverage partitions produced ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}.`)
    }
  }
}
