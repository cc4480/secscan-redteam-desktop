/** Successor-publication cases: current bytes, source preservation, and rerun idempotence. */

import { readFileSync, statSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generationLogFilename } from '../packages/session/session-persistence-jsonl/src/format.ts'
import { decompressZstdFrame, scanZstdFrames } from '../packages/session/session-persistence-jsonl/src/zstd.ts'
import { fixture, run, temporaryRoot, toolTurn } from './migrate-sessions-to-v4.spec-helpers.ts'

describe('one-time V4 migration command', () => {
  it.each(['none', 'zstd'] as const)('publishes %s successors, preserves sources and current bytes on rerun', async (compression) => {
    const root = temporaryRoot()
    const old = await fixture(root, 'old', 0, compression)
    const older = await fixture(root, 'tool/session~名', 0, compression)
    const source = await fixture(root, 'tool/session~名', 3, compression, toolTurn)
    const current = await fixture(root, 'current', 4, compression)
    await mkdir(join(root, '_no-cwd', 'empty'))
    const first = await run('--sessions-dir', root)
    expect(first.status, first.stdout + first.stderr).toBe(0)
    expect(first.stdout).toContain(`Session jobs: ${Math.min(availableParallelism(), 16)}`)
    expect(first.stdout).toContain('converted=2, already-V4=1, failed=0, skipped=1')
    expect(first.stdout).toContain('START session.v3.jsonl')
    expect(first.stdout).toContain('V3 -> V4: session.v4.jsonl')
    const checkoutCommit = /^Git HEAD: ([0-9a-f]{40})$/mu.exec(first.stdout)?.[1]
    expect(checkoutCommit).toBeDefined()
    expect(first.summary).toMatchObject({
      schemaVersion: 1,
      targetVersion: 4,
      sessionRoot: root,
      inputCount: 4,
      jobs: Math.min(availableParallelism(), 16),
      checkoutCommit,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      textLogPath: first.logPath,
      summaryPath: first.summaryPath,
      totals: { converted: 2, alreadyV4: 1, failed: 0, skipped: 1 },
      bySourceVersion: {
        '0': { converted: 1, alreadyV4: 0, failed: 0, skipped: 0 },
        '3': { converted: 1, alreadyV4: 0, failed: 0, skipped: 0 },
        '4': { converted: 0, alreadyV4: 1, failed: 0, skipped: 0 },
        unknown: { converted: 0, alreadyV4: 0, failed: 0, skipped: 1 },
      },
      failureGroups: [],
    })
    const target = join(source.directory, generationLogFilename(4, compression))
    const targetBytes = await readFile(target)
    const decoded = compression === 'none' ? targetBytes : Buffer.concat(await Promise.all(
      scanZstdFrames(targetBytes).frames.map(frame => decompressZstdFrame(targetBytes.subarray(frame.start, frame.end))),
    ))
    expect(decoded.toString()).toContain('"role":"tool"')
    expect(decoded.toString()).toContain('"text":"saved output"')
    expect(decoded.toString()).not.toContain('"type":"tool-result"')
    const second = await run('--sessions-dir', root)
    expect(second.status, second.stdout + second.stderr).toBe(0)
    expect(second.stdout).toContain('converted=0, already-V4=3, failed=0, skipped=1')
    expect(second.summary).toMatchObject({
      totals: { converted: 0, alreadyV4: 3, failed: 0, skipped: 1 },
      bySourceVersion: { '4': { converted: 0, alreadyV4: 3, failed: 0, skipped: 0 } },
      failureGroups: [],
    })
    expect(await readFile(target)).toEqual(targetBytes)
    for (const original of [old, older, source, current]) expect(await readFile(original.path)).toEqual(original.bytes)
    expect(first.logPath).toBeDefined()
    const log = readFileSync(first.logPath!, 'utf8')
    expect(log).toContain('Git HEAD: ')
    expect(log).toContain(`Node: ${process.version}; platform: ${process.platform}/${process.arch}`)
    expect(log).toContain(first.stdout.trim())
    expect(first.summaryPath).toBe(join(dirname(first.logPath!), 'summary.json'))
    const json = readFileSync(first.summaryPath!, 'utf8')
    expect(first.stdout.endsWith(json.trimEnd())).toBe(true)
    expect(log.endsWith(json)).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(first.logPath!).mode & 0o777).toBe(0o600)
      expect(statSync(first.summaryPath!).mode & 0o777).toBe(0o600)
    }
  })

  it.each(['none', 'zstd'] as const)('preserves %s parent/child history and catalog with serial or parallel jobs', async (compression) => {
    const outputs: Buffer[][] = []
    for (const jobs of [1, 2]) {
      const root = temporaryRoot()
      const parent = await fixture(root, 'a-parent', 3, compression)
      const child = await fixture(root, 'z-child', 3, compression, [
        { type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'saved child' } },
      ], { origin: 'subagent', parentSession: 'a-parent', createdAt: 2, delegationDepth: 1 })
      const result = await run('--sessions-dir', root, '--jobs', String(jobs))
      expect(result.status, result.stdout + result.stderr).toBe(0)
      expect(result.stdout).toContain('converted=2, already-V4=0, failed=0, skipped=0')
      expect(result.stdout).toContain('completed=2/2')
      const current: Buffer[] = []
      for (const original of [parent, child]) {
        expect(await readFile(original.path)).toEqual(original.bytes)
        const bytes = await readFile(join(original.directory, generationLogFilename(4, compression)))
        const decoded = compression === 'none' ? bytes : Buffer.concat(await Promise.all(
          scanZstdFrames(bytes).frames.map(frame => decompressZstdFrame(bytes.subarray(frame.start, frame.end))),
        ))
        current.push(decoded)
      }
      expect(current[0]!.toString().trim().split('\n').slice(1).map((line): unknown => JSON.parse(line))).toMatchObject([
        { type: 'subagent/catalog', data: { childId: 'z-child', childCreatedAt: 2, mode: 'continuable', label: 'saved child' } },
      ])
      outputs.push(current)
    }
    expect(outputs[1]).toEqual(outputs[0])
  })
})
