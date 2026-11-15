/** V4 migration orchestration over one Session root. */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { generationLogFilename } from '../packages/session/session-persistence-jsonl/src/format.ts'
import { JsonlGenerationSourceChangedError } from '../packages/session/session-persistence-jsonl/src/generation.ts'
import { directoryId, discover } from './migrate-sessions-to-v4-discovery.ts'
import { runMigrationJobs } from './migrate-sessions-to-v4-jobs.ts'
import { openMigrationReport } from './migrate-sessions-to-v4-report.ts'

/**
 * Publish V4 successors for every Session under one root.
 * @param root - absolute Session root path.
 * @param jobs - positive number of concurrent Session jobs.
 * @returns the process status: 1 when any input failed, otherwise 0.
 */
export async function migrate(root: string, jobs: number): Promise<number> {
  const report = openMigrationReport()
  const startedAt = new Date().toISOString()
  let inputCount = 0
  let checkoutCommit: string | null = null
  try {
    report.write(`Session migration to V4 started ${startedAt}`)
    report.write(`Root: ${root}`)
    report.write(`Session jobs: ${jobs}`)
    report.write(`Node: ${process.version}; platform: ${process.platform}/${process.arch}`)
    checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' }).trim()
    report.write(`Git HEAD: ${checkoutCommit}`)
    report.write(`Full log: ${report.logPath}`)
    assert.equal(SESSION_FORMAT_VERSION, 4, 'this one-time command requires a V4 Session writer')
    assert.equal(sessionFormatCatalog.currentVersion, 4, 'this one-time command requires a V4 format catalog')
    const candidates = await discover(root)
    inputCount = candidates.length
    report.write(`Discovered ${candidates.length} Session directories or invalid layout entries.`)
    const compression = candidates.find(candidate => candidate.source !== undefined)?.source?.compression ?? 'zstd'
    const ctx = new Context()
    try {
      await ctx.plugin(JsonlSessionPersistence, { root, compression })
      let completed = 0
      await runMigrationJobs(candidates.length, jobs, async (index, retry) => {
        const candidate = candidates[index]
        assert(candidate !== undefined, 'migration job index must name a discovered input')
        const { directory, source } = candidate
        const label = `[${index + 1}/${candidates.length}] ${JSON.stringify(relative(root, directory))}`
        const started = performance.now()
        report.write(`${label} ${retry ? 'RETRY' : 'START'} ${source === undefined ? 'inspect entry' : `${source.filename} (V${source.version}, ${source.bytes} bytes)`}`)
        const finish = (status: string): void => {
          completed += 1
          report.write(`${label} ${status}; completed=${completed}/${candidates.length}`)
        }
        try {
          if (candidate.error !== undefined) {
            throw candidate.error instanceof Error ? candidate.error : new Error('directory inspection failed', { cause: candidate.error })
          }
          if (source === undefined) {
            report.recordOutcome('unknown', 'skipped')
            finish('SKIPPED: no canonical Session generation')
            return false
          }
          const id = directoryId(directory)
          const handle = await ctx.sessionPersistence.open(id, source.version === 4 ? 'read' : 'write')
          await handle.close()
          report.recordOutcome(source.version, source.version === 4 ? 'alreadyV4' : 'converted')
          finish(`${source.version === 4 ? 'already V4 (opened successfully)' : `V${source.version} -> V4: ${generationLogFilename(4, source.compression)}`} (${((performance.now() - started) / 1000).toFixed(2)}s)`)
        } catch (error: unknown) {
          if (!retry && error instanceof JsonlGenerationSourceChangedError) {
            report.write(`${label} DEFERRED: ${error.message}; retry once after initial jobs finish`)
            report.recordDetail(error)
            return true
          }
          finish(`FAILED (${((performance.now() - started) / 1000).toFixed(2)}s)`)
          report.fail(source === undefined ? directory : join(directory, source.filename), error, source?.version)
        }
        return false
      })
    } finally {
      await ctx.fiber.dispose()
    }
  } catch (error: unknown) {
    report.fail(root, error)
  } finally {
    report.finish({ sessionRoot: root, inputCount, jobs, startedAt, checkoutCommit })
  }
  return report.totals.failed > 0 ? 1 : 0
}
