/**
 * Host signal forwarding and late aborts: a forwarded interruption marks the run skipped, and an
 * abort that arrives after the child exits still stops a detached descendant.
 */
import { describe, expect, it, vi } from 'vitest'
import { cliGateOptions, runGate, runGates, type Gate, type GateResult } from './run-gates.ts'
import {
  abortAndExpectTreeStopped,
  captureStreamedOutput,
  gate,
  resultFor,
  waitForGrandchildPid,
} from './run-gates-test-support.ts'

describe('fail-fast scheduling', () => {
  it('forwards host interruption signals to the abort path', async () => {
    const slow = gate('slow')
    const sibling = gate('sibling')
    const execute = vi.fn((subject: Gate, signal?: AbortSignal) => {
      if (subject.id === 'slow') {
        return new Promise<GateResult>((resolve) => {
          signal?.addEventListener('abort', () => {
            // A child can trap the signal and exit zero; the drain must still
            // record the gate skipped so the interrupted run fails.
            resolve({ ...resultFor(subject, 'passed'), aborted: true })
          }, { once: true })
        })
      }
      return Promise.resolve(resultFor(subject))
    })

    const promise = runGates([slow, sibling], 1, execute, () => {}, { failFast: true, forwardProcessSignals: true })
    // The first loop iteration starts `slow` synchronously, so its abort
    // listener is registered before the signal is emitted.
    process.emit('SIGTERM')
    const results = await promise

    expect(execute).toHaveBeenCalledOnce()
    expect(results.map(result => result.status)).toEqual(['skipped', 'skipped'])
    expect(results[0]).toMatchObject({
      status: 'skipped',
      error: 'aborted by fail-fast: host interruption',
    })
  })

  it('pairs host signal forwarding with fail-fast at the CLI entrypoint', () => {
    expect(cliGateOptions(true)).toEqual({ failFast: true, forwardProcessSignals: true })
    expect(cliGateOptions(false)).toEqual({ failFast: false, forwardProcessSignals: false })
  })

  it('rejects host signal forwarding without fail-fast', async () => {
    const execute = vi.fn((subject: Gate) => Promise.resolve(resultFor(subject)))

    await expect(runGates([gate('subject')], 1, execute, () => {}, { forwardProcessSignals: true }))
      .rejects.toThrow('forwardProcessSignals requires failFast')
    expect(execute).not.toHaveBeenCalled()
  })

  it('leaves an un-aborted child running to completion', async () => {
    const result = await runGate(gate('settles', { args: ['-e', ''] }), new AbortController().signal)

    expect(result.status).toBe('passed')
    expect(result.aborted).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('kills a detached descendant that outlived the child when the abort arrives later', async () => {
    const writes: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    const controller = new AbortController()
    let promise: Promise<GateResult> | undefined
    try {
      const script = [
        "const { spawn } = require('node:child_process')",
        // Detached with inherited stdio: the grandchild leads its own process
        // group (the gate group signal misses it) and holds the gate's
        // stdout write end (so `close` stays pending past the child exit).
        "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'inherit' })",
        "process.stdout.write('grandchild:' + grandchild.pid + '\\n')",
        // Outlive the first descendant-sampler tick with margin so the cache
        // holds the grandchild even on a loaded runner, then exit normally
        // before the abort arrives.
        "setTimeout(() => { process.stdout.write('child-exit\\n'); process.exit(0) }, 8000)",
      ].join(';')
      promise = runGate(gate('late-abort', { args: ['-e', script], streamOutput: true }), controller.signal)
      const pid = await waitForGrandchildPid(writes, 'child-exit', Date.now() + 10000)
      // terminate must not re-enumerate over the sampler cache now that the
      // child is gone; the detached grandchild is killed from the cached list.
      await abortAndExpectTreeStopped(promise, controller, pid)
    } finally {
      // A failed wait or assertion must not leave the forever-looping detached
      // grandchild behind on the host: abort the gate and wait for the
      // process tree to settle before restoring the spy.
      controller.abort()
      await promise
      write.mockRestore()
    }
  }, 20000)

  it.skipIf(process.platform === 'win32')('keeps a reparented detached descendant tracked across a sampler tick', async () => {
    const { writes, write } = captureStreamedOutput()
    const controller = new AbortController()
    let promise: Promise<GateResult> | undefined
    try {
      const script = [
        "const { spawn } = require('node:child_process')",
        // Wrapper spawns a detached grandchild with inherited stdio (its own
        // process group, holding the gate's stdout write end), prints the pid,
        // then exits after 7 seconds — after the first sampler tick, before
        // the second. From then on the grandchild is reparented and
        // unreachable by parent id.
        "const wrapper = spawn(process.execPath, ['-e', \"const { spawn } = require('node:child_process'); const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'inherit' }); process.stdout.write('grandchild:' + grandchild.pid + '\\\\n'); setTimeout(() => process.exit(0), 7000)\"], { stdio: 'inherit' })",
        "wrapper.on('exit', () => process.stdout.write('wrapper-exited\\n'))",
        // Keep the root child alive past the abort with a heartbeat so the
        // test can abort while it is still running.
        "setInterval(() => process.stdout.write('hb\\n'), 1000)",
      ].join(';')
      promise = runGate(gate('sampler-merge', { args: ['-e', script], streamOutput: true }), controller.signal)
      const pid = await waitForGrandchildPid(writes, 'wrapper-exited', Date.now() + 15000)
      // Wait past the second sampler tick (t=10) with margin: a replacing tick
      // would drop the reparented grandchild from the cache, after which the
      // abort cannot reach it. The root child keeps running throughout.
      const tickDeadline = Date.now() + 10000
      const wrapperExitedAt = Date.now()
      while (Date.now() - wrapperExitedAt < 5000 && Date.now() < tickDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(Date.now() - wrapperExitedAt).toBeGreaterThanOrEqual(5000)
      await abortAndExpectTreeStopped(promise, controller, pid)
    } finally {
      // A failed wait or assertion must not leave the forever-looping detached
      // grandchild behind on the host: abort the gate and wait for the
      // process tree to settle before restoring the spy.
      controller.abort()
      await promise
      write.mockRestore()
    }
  }, 30000)
})
