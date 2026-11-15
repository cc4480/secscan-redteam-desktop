/**
 * Gate process outcomes: the status a finished child reports, and the abort paths that stop a
 * gate, its descendants, or the whole aggregate.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  formatGateResultReason,
  runGate,
  runGates,
  type Gate,
  type GateResult,
} from './run-gates.ts'
import { captureStreamedOutput, gate, procStopped, resultFor } from './run-gates-test-support.ts'

describe('gate process outcomes', () => {
  it('streams selected gate output without retaining it', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      const result = await runGate(gate('streamed', {
        args: ['-e', "process.stdout.write('live output')"],
        streamOutput: true,
      }))

      expect(result.status).toBe('passed')
      expect(result.output).toEqual([])
      expect(write).toHaveBeenCalledWith('live output')
    } finally {
      write.mockRestore()
    }
  })

  it.skipIf(process.platform === 'win32')('reports signal termination independently from exit status', async () => {
    const result = await runGate(gate('terminated', {
      args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
    }))

    expect(result.status).toBe('failed')
    expect(result.exitCode).toBeNull()
    expect(result.signalCode).toBe('SIGTERM')
    expect(formatGateResultReason(result)).toBe('signal SIGTERM')
  })
})

describe('fail-fast scheduling', () => {
  it('aborts the aggregate at the first blocking failure', async () => {
    const slow = gate('slow')
    const fast = gate('fast')
    const dependent = gate('dependent', { needs: ['slow'] })
    const execute = vi.fn((subject: Gate, signal?: AbortSignal) => {
      if (subject.id === 'fast') {
        return new Promise<GateResult>((resolve) => {
          signal?.addEventListener('abort', () => {
            // The real runGate marks a gate the abort terminated; the drain
            // must then record it skipped rather than keep the failure.
            resolve({ ...resultFor(subject, 'failed'), aborted: true })
          }, { once: true })
        })
      }
      return Promise.resolve(resultFor(subject, subject.id === 'slow' ? 'failed' : 'passed'))
    })

    const results = await runGates([slow, fast, dependent], 2, execute, () => {}, { failFast: true })

    expect(execute.mock.calls.map(([subject]) => subject.id)).toEqual(['slow', 'fast'])
    expect(results.map(result => result.status)).toEqual(['failed', 'skipped', 'skipped'])
    expect(results[1]).toMatchObject({
      status: 'skipped',
      error: 'aborted by fail-fast: slow failed',
    })
    expect(results[2]).toMatchObject({
      status: 'skipped',
      error: 'aborted by fail-fast: slow failed',
    })
  })

  it('does not abort on a non-blocking gate failure', async () => {
    const observational = gate('observational', { allowFailure: true })
    const root = gate('root')
    const execute = vi.fn((subject: Gate) => Promise.resolve(
      resultFor(subject, subject.id === 'observational' ? 'failed' : 'passed'),
    ))

    const results = await runGates([observational, root], 2, execute, () => {}, { failFast: true })

    expect(execute).toHaveBeenCalledTimes(2)
    expect(results.map(result => result.status)).toEqual(['failed', 'passed'])
  })

  it('runs independent gates to completion when fail-fast is disabled', async () => {
    const root = gate('root')
    const sibling = gate('sibling')
    const execute = vi.fn((subject: Gate) => Promise.resolve(
      resultFor(subject, subject.id === 'root' ? 'failed' : 'passed'),
    ))

    const results = await runGates([root, sibling], 2, execute, () => {}, { failFast: false })

    expect(execute).toHaveBeenCalledTimes(2)
    expect(results.map(result => result.status)).toEqual(['failed', 'passed'])
  })

  it('kills the child when the abort signal fires', async () => {
    const controller = new AbortController()
    const promise = runGate(gate('killable', { args: ['-e', 'setInterval(() => {}, 1000)'] }), controller.signal)
    controller.abort()
    const result = await promise

    expect(result.status).toBe('failed')
    expect(result.aborted).toBe(true)
    if (process.platform !== 'win32') expect(result.signalCode).toBe('SIGTERM')
  })

  it.skipIf(process.platform === 'win32')('marks a zero-exit child as aborted when the signal fired', async () => {
    const { writes, write } = captureStreamedOutput()
    try {
      const controller = new AbortController()
      const child = gate('traps-signal', {
        args: ['-e', "process.stdout.write('ready\\n'); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"],
        streamOutput: true,
      })
      const promise = runGate(child, controller.signal)
      // Wait for the child to register its SIGTERM trap before aborting, so
      // the signal is caught and the child really exits zero.
      const deadline = Date.now() + 5000
      while (!writes.join('').includes('ready') && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      controller.abort()
      const result = await promise

      // The child trapped the signal and exited zero; the drain must not
      // report this gate passed, so the raw outcome carries the abort mark.
      expect(result.status).toBe('passed')
      expect(result.aborted).toBe(true)
    } finally {
      write.mockRestore()
    }
  })

  it.skipIf(process.platform === 'win32')('kills the whole gate process tree when the abort signal fires', async () => {
    const { writes, write } = captureStreamedOutput()
    const controller = new AbortController()
    let promise: Promise<GateResult> | undefined
    try {
      const script = [
        "const { spawn } = require('node:child_process')",
        // Detached, so the grandchild leads its own process group: the gate
        // group signal cannot reach it, and only the descendant enumeration in
        // treeKill does — the shape of a nested run-gates' leaf gates.
        "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true })",
        "process.stdout.write('grandchild:' + grandchild.pid + '\\n')",
        'setInterval(() => {}, 1000)',
      ].join(';')
      promise = runGate(gate('tree', { args: ['-e', script], streamOutput: true }), controller.signal)
      const deadline = Date.now() + 5000
      let pid: number | undefined
      while (pid === undefined && Date.now() < deadline) {
        const match = writes.join('').match(/grandchild:(\d+)/)
        if (match !== null) pid = Number(match[1])
        else await new Promise(resolve => setTimeout(resolve, 20))
      }
      expect(pid ?? 0).toBeGreaterThan(0)
      controller.abort()
      const result = await promise
      expect(result.status).toBe('failed')
      // The descendant enumeration signals the detached grandchild at the same
      // time as the group signal reaches the direct child; the direct child's
      // own death closes the gate pipes, so poll for the grandchild to stop
      // executing rather than asserting on a fixed instant.
      const stopDeadline = Date.now() + 5000
      while (!procStopped(pid ?? 0) && Date.now() < stopDeadline) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      expect(procStopped(pid ?? 0)).toBe(true)
    } finally {
      // A failed wait or assertion must not leave the forever-looping detached
      // grandchild behind on the host: abort the gate and wait for the
      // process tree to settle before restoring the spy.
      controller.abort()
      await promise
      write.mockRestore()
    }
  })
})
