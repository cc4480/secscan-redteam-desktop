/** Shared corpora, contributor-command runs, and Session fixtures for the V4 migration cases. */

import { mkdtempSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, expect } from 'vitest'
import { execa } from 'execa'
import type { SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { encodeSegment, generationLogFilename, type JsonlCompression } from '../packages/session/session-persistence-jsonl/src/format.ts'
import { compressZstdFrame } from '../packages/session/session-persistence-jsonl/src/zstd.ts'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

/** Repository root the contributor command and its entrypoint resolve against. */
export const repository = resolve(import.meta.dirname, '..')
/** The contributor migration entrypoint under test. */
export const script = join(repository, 'scripts/migrate-sessions-to-v4.ts')
const directories = new Set<string>()
const stopProcesses: Array<() => Promise<void>> = []

/**
 * Create a private corpus root removed after each case.
 * @returns the new absolute directory path.
 */
export function temporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-migrate-v4-test-'))
  directories.add(directory)
  return directory
}

/**
 * Run a Node entrypoint as a child process and parse its final summary.
 * @param entrypoint - absolute path of the module to run.
 * @param args - contributor-command arguments.
 * @returns the captured streams, exit status, and artifact paths.
 */
export async function runAt(entrypoint: string, ...args: string[]) {
  const child = execa(process.execPath, ['--import', 'tsx', entrypoint, ...args], {
    cwd: repository, reject: false,
  })
  stopProcesses.push(async () => { child.kill('SIGKILL'); await child })
  const result = await child
  const logPath = [...result.stdout.matchAll(/^Full log: (.+)$/gmu)].at(-1)?.[1]
  const summaryPath = [...result.stdout.matchAll(/^JSON summary: (.+)$/gmu)].at(-1)?.[1]
  if (logPath !== undefined) directories.add(dirname(logPath))
  expect(result.timedOut, result.stderr).toBe(false)
  expect(result.signal, result.stderr).toBeUndefined()
  const summary: unknown = summaryPath === undefined ? undefined : JSON.parse(readFileSync(summaryPath, 'utf8'))
  return { stdout: result.stdout, stderr: result.stderr, status: result.exitCode, logPath, summaryPath, summary }
}

/**
 * Run the contributor migration entrypoint.
 * @param args - contributor-command arguments.
 * @returns the captured streams, exit status, and artifact paths.
 */
export function run(...args: string[]) {
  return runAt(script, ...args)
}

afterEach(async () => {
  await Promise.all(stopProcesses.splice(0).map(stop => stop()))
  for (const directory of directories) removeFixtureSafely(directory)
  directories.clear()
})

/** One complete turn carrying a tool call and its result, in the V3 event form. */
export const toolTurn: readonly SessionFormatJsonObject[] = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'step/start', data: { turn: 1, step: 1 } },
  { type: 'request/header', data: { reason: 'initial', header: { config: { provider: 'mock', model: 'mock' } } } },
  { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: {
    id: 'assistant', role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' },
    content: [{ type: 'tool-call', id: 'call', name: 'read', arguments: '{}' }],
  } } },
  { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call', name: 'read', arguments: '{}' } },
  { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: {
    id: 'result', role: 'user', source: { kind: 'tool', callId: 'call' },
    content: [{ type: 'tool-result', toolCallId: 'call', isError: false, content: [{ type: 'text', text: 'saved output' }] }],
  } } },
  { type: 'step/end', data: { turn: 1, step: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
]

/**
 * Write one Session generation log for a corpus.
 * @param root - corpus root the `_no-cwd` project directory sits in.
 * @param id - Session id, encoded into the project segment.
 * @param version - generation format version written in the header.
 * @param compression - body compression the generation filename declares.
 * @param events - events appended after the header, sequenced from zero.
 * @param headerFields - extra header fields merged over the defaults.
 * @returns the written path, its exact bytes, and the project directory.
 */
export async function fixture(
  root: string, id: string, version: number, compression: JsonlCompression, events: readonly SessionFormatJsonObject[] = [],
  headerFields: SessionFormatJsonObject = {},
) {
  const directory = join(root, '_no-cwd', encodeSegment(id))
  await mkdir(directory, { recursive: true })
  const header = JSON.stringify({ type: 'session', version, id, createdAt: 1, delegationDepth: 0,
    ...version >= 2 ? { isSeeded: false } : {},
    ...headerFields,
  }) + '\n'
  const body = events.map((event, seq) => JSON.stringify({ ...event, seq, time: seq + 2 }) + '\n').join('')
  const bytes = compression === 'none' ? Buffer.from(header + body) : Buffer.concat([
    await compressZstdFrame(header), ...body === '' ? [] : [await compressZstdFrame(body)],
  ])
  const path = join(directory, generationLogFilename(version, compression))
  await writeFile(path, bytes)
  return { path, bytes, directory }
}
