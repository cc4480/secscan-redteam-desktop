/** Failure-reporting cases: per-input diagnostics, failure grouping, and changed-source deferral. */

import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fixture, repository, run, runAt, script, temporaryRoot, toolTurn } from './migrate-sessions-to-v4.spec-helpers.ts'

describe('one-time V4 migration command', () => {
  it('reports a bad Session and still migrates a later good Session', async () => {
    const root = temporaryRoot()
    const bad = await fixture(root, 'a-bad', 3, 'none', [{ type: 'unrecognized/required', data: {} }])
    const good = await fixture(root, 'z-good', 3, 'none', toolTurn)
    const result = await run('--sessions-dir', root)
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stdout, readFileSync(result.logPath!, 'utf8')).toContain('converted=1, already-V4=0, failed=1, skipped=0')
    expect(result.stdout).toMatch(/\[1\/2\].*FAILED/u)
    expect(result.stdout).toMatch(/\[2\/2\].*V3 -> V4/u)
    expect(result.stdout).not.toContain('DEFERRED')
    expect(result.stdout).not.toContain('RETRY')
    expect(result.stdout).toContain('Failures (full stacks and causes are in the log):')
    expect(result.stdout).toContain(bad.path)
    expect(readFileSync(result.logPath!, 'utf8')).toContain('unrecognized/required')
    expect(await readFile(bad.path)).toEqual(bad.bytes)
    expect(existsSync(join(bad.directory, 'session.v4.jsonl'))).toBe(false)
    expect(existsSync(join(good.directory, 'session.v4.jsonl'))).toBe(true)
  })

  it('groups matching failures by source version while retaining each input diagnostic', async () => {
    const root = temporaryRoot()
    const event = { type: 'unrecognized/required', data: {} }
    const first = await fixture(root, 'a-v3', 3, 'none', [event])
    const second = await fixture(root, 'b-v3', 3, 'none', [event])
    const legacy = await fixture(root, 'c-v0', 0, 'none', [event])
    const result = await run('--sessions-dir', root)
    expect(result.status, result.stdout + result.stderr).toBe(1)
    const anyString: unknown = expect.any(String)
    expect(result.summary).toMatchObject({
      inputCount: 3,
      totals: { converted: 0, alreadyV4: 0, failed: 3, skipped: 0 },
      bySourceVersion: {
        '0': { converted: 0, alreadyV4: 0, failed: 1, skipped: 0 },
        '3': { converted: 0, alreadyV4: 0, failed: 2, skipped: 0 },
      },
      failureGroups: [
        { sourceVersion: 0, reason: 'unknown_event', eventType: 'unrecognized/required', count: 1,
          items: [{ inputPath: legacy.path, reason: 'unknown_event', errorName: anyString, message: anyString }] },
        { sourceVersion: 3, reason: 'unknown_event', eventType: 'unrecognized/required', count: 2,
          items: [
            { inputPath: first.path, reason: 'unknown_event', errorName: anyString, message: anyString },
            { inputPath: second.path, reason: 'unknown_event', errorName: anyString, message: anyString },
          ] },
      ],
    })
    for (const source of [first, second, legacy]) expect(await readFile(source.path)).toEqual(source.bytes)
  })

  it('groups sequence failures without dropping their distinct sequence coordinates', async () => {
    const root = temporaryRoot()
    const items: Array<{ inputPath: string; expectedSeq: number; actualSeq: number }> = []
    for (const [id, actualSeq] of [['a-gap', 2], ['b-gap', 4]] as const) {
      const source = await fixture(root, id, 2, 'none', [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'step/start', data: { turn: 1, step: 1 } },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ])
      await writeFile(source.path, source.bytes.toString().replace('"seq":1', `"seq":${actualSeq}`))
      items.push({ inputPath: source.path, expectedSeq: 1, actualSeq })
    }
    const result = await run('--sessions-dir', root)
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.summary).toMatchObject({
      inputCount: 2,
      totals: { converted: 0, alreadyV4: 0, failed: 2, skipped: 0 },
      bySourceVersion: { '2': { converted: 0, alreadyV4: 0, failed: 2, skipped: 0 } },
      failureGroups: [{ sourceVersion: 2, reason: 'sequence_gap', count: 2, items }],
    })
  })

  it('reports a source-change deferral and retries after the other input completes', async () => {
    const root = temporaryRoot()
    const parent = await fixture(root, 'a-parent', 3, 'none')
    const child = await fixture(root, 'b-child', 3, 'none', [{
      type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'fixture child' },
    }], { origin: 'subagent', parentSession: 'a-parent', createdAt: 2, delegationDepth: 1 })
    const entrypoint = join(temporaryRoot(), 'retry-once.mjs')
    const backendUrl = pathToFileURL(join(repository, 'packages/session/session-persistence-jsonl/src/index.ts')).href
    const generationUrl = pathToFileURL(join(repository, 'packages/session/session-persistence-jsonl/src/generation.ts')).href
    await writeFile(entrypoint, `
      const { default: Backend } = await import(${JSON.stringify(backendUrl)});
      const { JsonlGenerationSourceChangedError } = await import(${JSON.stringify(generationUrl)});
      const open = Backend.prototype.open;
      let changed = false;
      Backend.prototype.open = async function(id, access, options) {
        if (id === 'a-parent' && access === 'write' && !changed) {
          changed = true;
          throw new JsonlGenerationSourceChangedError(${JSON.stringify(child.path)});
        }
        return open.call(this, id, access, options);
      };
      process.argv[1] = ${JSON.stringify(script)};
      await import(${JSON.stringify(pathToFileURL(script).href)});
    `)
    const result = await runAt(entrypoint, '--sessions-dir', root, '--jobs', '2')
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const lines = result.stdout.split('\n')
    const deferred = lines.findIndex(line => line.includes('[1/2]') && line.includes('DEFERRED'))
    const childDone = lines.findIndex(line => line.includes('[2/2]') && line.includes('completed=1/2'))
    const retry = lines.findIndex(line => line.includes('[1/2]') && line.includes('RETRY'))
    expect(deferred).toBeGreaterThanOrEqual(0)
    expect(childDone).toBeGreaterThan(deferred)
    expect(retry).toBeGreaterThan(childDone)
    expect(lines.filter(line => line.includes('RETRY'))).toHaveLength(1)
    expect(result.summary).toMatchObject({ totals: { converted: 2, alreadyV4: 0, failed: 0, skipped: 0 }, failureGroups: [] })
    const target = await readFile(join(parent.directory, 'session.v4.jsonl'), 'utf8')
    expect(target).toContain('"type":"subagent/catalog"')
    for (const source of [parent, child]) expect(await readFile(source.path)).toEqual(source.bytes)
  })
})
