/**
 * Fixtures shared by the run-gates gate-graph suites: the environment stubs each
 * graph test runs under, and the process and output helpers the process-tree
 * suites share.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, vi, type MockInstance } from 'vitest'
import type { Gate, GateResult } from './run-gates.ts'

// Graph fixtures select their own browser pool instead of inheriting the CI host's pool.
beforeEach(() => vi.stubEnv('DSH_WEB_SNAPSHOT_WORKERS', undefined))
afterEach(() => vi.unstubAllEnvs())

/**
 * Capture output a gate streams through runGate's streamOutput path.
 * @returns the accumulated chunks and the stdout spy to restore in finally.
 */
export function captureStreamedOutput(): { writes: string[]; write: MockInstance } {
  const writes: string[] = []
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  return { writes, write }
}

/**
 * A process has stopped executing when its /proc entry is gone, or when it
 * lingers as a zombie ('Z') — an un-reaped but dead entry still answers
 * kill(pid, 0), so existence is not a liveness check. Non-Linux falls back to
 * kill(pid, 0), whose ESRCH means the process is gone.
 * @param pid - the process id to inspect.
 * @returns true when the process is gone or lingers as a zombie.
 */
export function procStopped(pid: number): boolean {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      return /\)\s+Z\s/.test(stat)
    } catch {
      return true
    }
  }
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

/**
 * Wait until the captured output contains `marker` and the grandchild pid the
 * gate printed, then return that pid.
 * @param writes - chunks captured from the gate's streamed stdout.
 * @param marker - the output line that proves the gate reached the abort point.
 * @param deadline - fail the wait when exceeded.
 * @returns the grandchild pid printed by the gate script.
 */
export async function waitForGrandchildPid(writes: string[], marker: string, deadline: number): Promise<number> {
  let pid: number | undefined
  while ((pid === undefined || !writes.join('').includes(marker)) && Date.now() < deadline) {
    const match = writes.join('').match(/grandchild:(\d+)/)
    if (match !== null) pid = Number(match[1])
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  expect(pid ?? 0).toBeGreaterThan(0)
  expect(writes.join('')).toContain(marker)
  return pid as number
}

/**
 * Abort the run and assert it settles marked aborted with the grandchild no
 * longer executing — the abort path must have signalled it from the captured
 * descendant list rather than settling over a live orphan.
 * @param promise - the pending `runGate` promise.
 * @param controller - the signal source to abort.
 * @param pid - the grandchild pid the gate script printed.
 */
export async function abortAndExpectTreeStopped(promise: Promise<GateResult>, controller: AbortController, pid: number): Promise<void> {
  controller.abort()
  const result = await promise
  expect(result.aborted).toBe(true)
  const stopDeadline = Date.now() + 8000
  while (!procStopped(pid) && Date.now() < stopDeadline) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  expect(procStopped(pid)).toBe(true)
}

/**
 * Build a gate graph node that runs this Node binary, overriding only the
 * fields one test varies.
 * @param id - the gate id, also the default label and command text.
 * @param options - gate fields replaced on the default node.
 * @returns the gate under test.
 */
export function gate(id: string, options: Partial<Gate> = {}): Gate {
  return {
    id,
    label: id,
    displayCommand: `run ${id}`,
    command: process.execPath,
    args: ['-e', ''],
    ...options,
  }
}

/**
 * Build the settled result a fake executor returns for one gate.
 * @param subject - the gate the result reports on.
 * @param status - the status the result carries; any other status exits non-zero.
 * @returns the gate result.
 */
export function resultFor(subject: Gate, status: GateResult['status'] = 'passed'): GateResult {
  return {
    gate: subject,
    status,
    durationMs: 10,
    output: [],
    exitCode: status === 'passed' ? 0 : 1,
    signalCode: null,
  }
}

/**
 * Run one action with npm_execpath pointed at a pnpm entrypoint, restoring the
 * previous value afterwards.
 * @param action - the work to run under the substituted entrypoint.
 * @param entrypoint - the entrypoint path the gate graph reads.
 * @returns whatever the action returns.
 */
export function withPnpmEntrypoint<T>(action: () => T, entrypoint = '/private/pnpm.cjs'): T {
  const previous = process.env.npm_execpath
  process.env.npm_execpath = entrypoint
  try {
    return action()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'npm_execpath')
    else process.env.npm_execpath = previous
  }
}

/**
 * Run one action with a process environment variable set or removed, restoring
 * the previous value afterwards.
 * @param name - the variable name.
 * @param value - the value to set, or undefined to remove it for the action.
 * @param action - the work to run under the substituted environment.
 * @returns whatever the action returns.
 */
export function withEnv<T>(name: string, value: string | undefined, action: () => T): T {
  const previous = process.env[name]
  if (value === undefined) Reflect.deleteProperty(process.env, name)
  else process.env[name] = value
  try {
    return action()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = previous
  }
}
