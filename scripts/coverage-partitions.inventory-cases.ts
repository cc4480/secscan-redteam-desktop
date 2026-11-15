/** Test-file inventory parsing and recorded per-file durations. */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectPartitionDurations,
  parseListOutput,
  readFileDurations,
  writeFileDurations,
} from './coverage-partitions.ts'
import { temporaryRoot, writeVitestCache } from './coverage-partitions.fixtures-cases.ts'

describe('coverage file inventory', () => {
  it('parses vitest list --filesOnly output, keeps project ownership, and drops exempt suites', async () => {
    const root = await temporaryRoot()
    const exemptDir = join(root, 'packages/experimental/webworker-runtime/tests')
    await mkdir(exemptDir, { recursive: true })
    await writeFile(join(exemptDir, 'transform-corpus.spec.ts'), '')
    const output = [
      '[thread-safe] packages/a/tests/a.spec.ts',
      '[process-bound] packages/b/tests/b.spec.ts',
      '[thread-safe] packages/experimental/webworker-runtime/tests/transform-corpus.spec.ts',
      'not a test line',
    ].join('\n')
    const inventory = parseListOutput(output, root)
    expect(inventory.files).toEqual([
      'packages/a/tests/a.spec.ts',
      'packages/b/tests/b.spec.ts',
    ])
    expect(inventory.projectOf.get('packages/a/tests/a.spec.ts')).toBe('thread-safe')
    expect(inventory.projectOf.get('packages/b/tests/b.spec.ts')).toBe('process-bound')
  })

  it('removes every Typert package from instrumented files and project assignments', async () => {
    const root = await temporaryRoot()
    const typertFiles = [
      'packages/typert/generator/tests/type-model.spec.ts',
      'packages/typert/loader/tests/loader.spec.ts',
      'packages/typert/protocol/tests/protocol.spec.ts',
      'packages/typert/registry/tests/typert.spec.ts',
      'packages/typert/future/tests/nested/client.spec.tsx',
    ]
    for (const file of typertFiles) {
      await mkdir(dirname(join(root, file)), { recursive: true })
      await writeFile(join(root, file), '')
    }
    const retained = 'packages/api/gateway/tests/rpc.spec.ts'
    const inventory = parseListOutput(
      [...typertFiles, retained].map(file => `[thread-safe] ${file}`).join('\n'),
      root,
    )
    expect(inventory.files).toEqual([retained])
    expect([...inventory.projectOf]).toEqual([[retained, 'thread-safe']])
  })

  it('averages recorded durations per file from the results cache', async () => {
    const root = await temporaryRoot()
    await writeVitestCache(root, [
      ['thread-safe:packages/a/tests/x.spec.ts', { duration: 10 }],
      ['process-bound:packages/a/tests/x.spec.ts', { duration: 30 }],
      ['thread-safe:packages/a/tests/y.spec.ts', { duration: 5 }],
    ])
    const durations = readFileDurations(root)
    expect(durations.get('packages/a/tests/x.spec.ts')).toBe(20)
    expect(durations.get('packages/a/tests/y.spec.ts')).toBe(5)
  })

  it('prefers the persisted duration file over the vitest cache', async () => {
    const root = await temporaryRoot()
    await writeVitestCache(root, [['thread-safe:packages/a/tests/x.spec.ts', { duration: 100 }]])
    writeFileDurations(root, new Map([['packages/a/tests/x.spec.ts', 42]]))
    expect(readFileDurations(root).get('packages/a/tests/x.spec.ts')).toBe(42)
  })

  it('merges new durations into the persisted file', async () => {
    const root = await temporaryRoot()
    writeFileDurations(root, new Map([['packages/a/tests/x.spec.ts', 42]]))
    writeFileDurations(root, new Map([
      ['packages/a/tests/x.spec.ts', 55],
      ['packages/a/tests/y.spec.ts', 7],
    ]))
    const durations = readFileDurations(root)
    expect(durations.get('packages/a/tests/x.spec.ts')).toBe(55)
    expect(durations.get('packages/a/tests/y.spec.ts')).toBe(7)
  })

  it('extracts per-file durations from partition json reports', async () => {
    const root = await temporaryRoot()
    const report = join(root, 'partition-1.report.json')
    await writeFile(report, JSON.stringify({
      testResults: [
        { name: join(root, 'packages/a/tests/x.spec.ts'), startTime: 1000, endTime: 1500 },
        { name: 'not-a-spec', startTime: 1, endTime: 2 },
      ],
    }))
    const durations = collectPartitionDurations([report], root)
    expect(durations.get('packages/a/tests/x.spec.ts')).toBe(500)
  })
})
