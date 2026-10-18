/**
 * Tool readiness for the welcome window: the doctor report is run once through an
 * injectable child, mapped into a view, and every failure path returns a reason
 * that never carries a command line, an environment value, or a token.
 */

import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  runRunnerReadiness,
  type ReadinessResult,
  type ReadinessView,
  type SpawnedChildLike,
} from '../src/readiness.ts'

/** A directory shaped like the one the application ships the runner at. */
const RUNNER_DIR = join('C:', 'repo', 'apps', 'desktop', 'resources', 'redteam-runner')

/** A child that never launches a process: output streams are PassThroughs, events are emitted by the test. */
class FakeChild implements SpawnedChildLike {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly signals: string[] = []
  private readonly emitter = new EventEmitter()

  on(event: 'exit', listener: (code: number | null) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit' | 'error', listener: (arg: number | null | Error) => void): void {
    this.emitter.on(event, listener)
  }

  kill(): void {
    this.signals.push('kill')
  }

  emitExit(code: number | null): void {
    this.emitter.emit('exit', code)
  }

  emitError(error: Error): void {
    this.emitter.emit('error', error)
  }
}

/** @returns a well-formed doctor report, overridden by the caller. */
function report(overrides: Partial<ReadinessView> = {}): ReadinessView {
  return {
    ok: true,
    summary: '2 of 2 ready',
    items: [
      { id: 'nmap', label: 'nmap (port/service discovery)', state: 'ready', required: true },
      { id: 'wordlist', label: 'content-discovery wordlist', state: 'ready', required: true },
    ],
    ...overrides,
  }
}

/** @returns a run against a fake child, so the real runner is never launched. */
function run(child: FakeChild, options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<ReadinessResult> {
  return runRunnerReadiness({
    node: 'node',
    runnerDirectory: RUNNER_DIR,
    spawn: () => child,
    ...options,
  })
}

describe('runRunnerReadiness', () => {
  it('parses a doctor report into the view and runs node with doctor --json', async () => {
    const child = new FakeChild()
    let command = ''
    let args: readonly string[] = []
    const pending = runRunnerReadiness({
      node: 'node',
      runnerDirectory: RUNNER_DIR,
      spawn: (spawnedCommand, spawnedArgs) => { command = spawnedCommand; args = spawnedArgs; return child },
    })
    child.stdout.write(JSON.stringify(report()))
    child.emitExit(0)

    const result = await pending
    expect(result).toEqual({ ok: true, readiness: report() })
    expect(command).toBe('node')
    expect(args).toEqual([join(RUNNER_DIR, 'dist', 'cli.js'), 'doctor', '--json'])
  })

  it('reports a non-zero exit and quotes the child stderr', async () => {
    const child = new FakeChild()
    const pending = run(child)
    child.stderr.write('something broke\n')
    child.emitExit(2)

    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('exited with code 2')
      expect(result.reason).toContain('something broke')
    }
  })

  it('reports unparseable stdout as a failure', async () => {
    const child = new FakeChild()
    const pending = run(child)
    child.stdout.write('not json')
    child.emitExit(0)

    expect(await pending).toEqual({ ok: false, reason: 'the readiness doctor returned unparseable output' })
  })

  it('reports a spawn error as a failure', async () => {
    const child = new FakeChild()
    const pending = run(child)
    child.emitError(new Error('spawn node ENOENT'))

    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('could not be started')
  })

  it('reports a timeout and kills the child when it exposes a kill method', async () => {
    const child = new FakeChild()
    const pending = run(child, { timeoutMs: 20 })

    expect(await pending).toEqual({ ok: false, reason: 'the readiness doctor did not finish in time' })
    expect(child.signals).toEqual(['kill'])
  })

  it('passes a detail containing a path through unchanged', async () => {
    const child = new FakeChild()
    const pending = run(child)
    const detail = 'C:\\tools\\nmap\\nmap.exe'
    child.stdout.write(JSON.stringify(report({
      items: [{ id: 'nmap', label: 'nmap', state: 'ready', detail, required: true }],
    })))
    child.emitExit(0)

    const result = await pending
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.readiness.items[0].detail).toBe(detail)
  })

  it('never leaks an environment token into a failure reason', async () => {
    const child = new FakeChild()
    const pending = run(child, { env: { SECSCAN_MCP_TOKEN: 's3cret-token-value' } })
    child.stderr.write('diagnostic line\n')
    child.emitExit(1)

    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).not.toContain('SECSCAN_MCP_TOKEN')
      expect(result.reason).not.toContain('s3cret-token-value')
    }
  })

  it('reports a report without items as a failure', async () => {
    const child = new FakeChild()
    const pending = run(child)
    child.stdout.write(JSON.stringify({ ok: true, summary: 'nothing' }))
    child.emitExit(0)

    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('without readiness items')
  })

  it('reports output that exceeds the size cap as a failure', async () => {
    const child = new FakeChild()
    const pending = run(child)
    child.stdout.write('x'.repeat(256 * 1024 + 1))
    child.emitExit(0)

    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('exceeded the supported size')
  })
})
