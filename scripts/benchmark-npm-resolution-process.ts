/** Bounded child-process execution for the npm resolution benchmark. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const TERMINATION_GRACE_MS = 1_000
const FORCED_EXIT_TIMEOUT_MS = 5_000

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

function signalProcessTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (child.pid === undefined) {
    child.kill(signal)
    return
  }
  if (process.platform === 'win32') {
    const force = signal === 'SIGKILL' ? ['/F'] : []
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', ...force], {
      stdio: 'ignore',
      windowsHide: true,
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0 && child.exitCode === null && child.signalCode === null) child.kill(signal)
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/**
 * Run one command with bounded process-tree termination after its deadline.
 * @param command - Executable path or name.
 * @param args - Arguments passed without shell interpolation on POSIX.
 * @param options - Working directory, environment, timeout, and termination grace.
 * @returns Exit facts, captured output, duration, and whether timeout handling began.
 */
export async function runCommandWithTimeout(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly env: NodeJS.ProcessEnv
    readonly timeoutMs: number
    readonly terminationGraceMs?: number
  },
): Promise<{ status: number | null; signal: NodeJS.Signals | null; durationMs: number; output: string; timedOut: boolean }> {
  const started = performance.now()
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    detached: process.platform !== 'win32',
    env: options.env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  const exited = new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', (status, signal) => { resolveExit({ status, signal }) })
  })
  let timeout: NodeJS.Timeout | undefined
  try {
    const first = await Promise.race([
      exited.then(outcome => ({ type: 'exit' as const, outcome })),
      new Promise<{ type: 'timeout' }>((resolveTimeout) => {
        timeout = setTimeout(() => { resolveTimeout({ type: 'timeout' }) }, options.timeoutMs)
      }),
    ])
    if (first.type === 'exit') {
      return { ...first.outcome, durationMs: performance.now() - started, output, timedOut: false }
    }

    signalProcessTree(child, 'SIGTERM')
    await delay(options.terminationGraceMs ?? TERMINATION_GRACE_MS)
    signalProcessTree(child, 'SIGKILL')
    const forced = await Promise.race([
      exited,
      delay(FORCED_EXIT_TIMEOUT_MS).then(() => undefined),
    ])
    if (forced === undefined) throw new Error('timed-out process tree did not exit after SIGKILL')
    return { ...forced, durationMs: performance.now() - started, output, timedOut: true }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
