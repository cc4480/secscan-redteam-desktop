/** Text log, outcome tally, and JSON summary artifact of one V4 migration run. */

import { appendFileSync, closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { classifyMigrationFailure } from './migration-failure-summary.ts'
import { emptyCounts, summarizeFailures, type Failure, type OutcomeCounts, type SourceVersion } from './migrate-sessions-to-v4-outcomes.ts'

/** Run facts the migration orchestration supplies when the run ends. */
export interface MigrationSummary {
  sessionRoot: string
  inputCount: number
  jobs: number
  startedAt: string
  checkoutCommit: string | null
}

/** Log and outcome sink for one in-progress migration run. */
export interface MigrationReport {
  /** Full path of the text log in the private temporary directory. */
  readonly logPath: string
  /** Running outcome tally; a nonzero `failed` decides the process status. */
  readonly totals: OutcomeCounts
  /**
   * Echo one line to stdout and the log.
   * @param line - line to record without its newline.
   */
  write(line: string): void
  /**
   * Append an inspected error to the log without echoing it to stdout.
   * @param error - rejection or caught value to inspect in full.
   */
  recordDetail(error: unknown): void
  /**
   * Count one outcome, in total and under its source version.
   * @param version - source version the outcome belongs to.
   * @param outcome - outcome counter to increment.
   */
  recordOutcome(version: SourceVersion, outcome: keyof OutcomeCounts): void
  /**
   * Record a failed input, echo its message, and append the inspected error to the log.
   * @param inputPath - path of the input that failed.
   * @param error - rejection or caught value to diagnose.
   * @param sourceVersion - source version, defaulting to `unknown`.
   */
  fail(inputPath: string, error: unknown, sourceVersion?: SourceVersion): void
  /**
   * Write the closing summary to stdout, the log, and the JSON summary file, then close the log.
   * @param summary - run facts to place in the JSON summary.
   */
  finish(summary: MigrationSummary): void
}

/**
 * Create the private temporary report directory and open its text log.
 * @returns the log and outcome sink for one migration run.
 */
export function openMigrationReport(): MigrationReport {
  const reportDirectory = mkdtempSync(join(tmpdir(), 'dsh-migrate-v4-'))
  const logPath = join(reportDirectory, 'migration.log')
  const summaryPath = join(reportDirectory, 'summary.json')
  const log = openSync(logPath, 'wx', 0o600)
  const totals = emptyCounts()
  const bySourceVersion: Record<string, OutcomeCounts> = {}
  const failures: Failure[] = []
  const write = (line: string): void => {
    appendFileSync(log, `${line}\n`)
    console.log(line)
  }
  const recordDetail = (error: unknown): void => {
    appendFileSync(log, `${inspect(error, { depth: null, colors: false })}\n`)
  }
  const recordOutcome = (version: SourceVersion, outcome: keyof OutcomeCounts): void => {
    totals[outcome] += 1
    const counts = bySourceVersion[String(version)] ??= emptyCounts()
    counts[outcome] += 1
  }
  const fail = (inputPath: string, error: unknown, sourceVersion: SourceVersion = 'unknown'): void => {
    const diagnostic = classifyMigrationFailure(error)
    failures.push({ inputPath, sourceVersion, ...diagnostic })
    recordOutcome(sourceVersion, 'failed')
    write(`ERROR ${JSON.stringify(inputPath)}: ${diagnostic.message}`)
    recordDetail(error)
  }
  const finish = ({ sessionRoot, inputCount, jobs, startedAt, checkoutCommit }: MigrationSummary): void => {
    try {
      write(`Summary: converted=${totals.converted}, already-V4=${totals.alreadyV4}, failed=${totals.failed}, skipped=${totals.skipped}`)
      if (failures.length > 0) {
        write('Failures (full stacks and causes are in the log):')
        for (const failure of failures) write(`- ${JSON.stringify(failure.inputPath)}: ${failure.message}`)
      }
      write(`Full log: ${logPath}`)
      const payload = JSON.stringify({
        schemaVersion: 1,
        targetVersion: 4,
        sessionRoot,
        inputCount,
        jobs,
        startedAt,
        finishedAt: new Date().toISOString(),
        checkoutCommit,
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        textLogPath: logPath,
        summaryPath,
        totals,
        bySourceVersion,
        failureGroups: summarizeFailures(failures),
      }, null, 2)
      writeFileSync(summaryPath, `${payload}\n`, { flag: 'wx', mode: 0o600 })
      write(`JSON summary: ${summaryPath}`)
      write(payload)
    } finally {
      closeSync(log)
    }
  }
  return { logPath, totals, write, recordDetail, recordOutcome, fail, finish }
}
