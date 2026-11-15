/** Child-process execution for one gate, including process-tree termination. */
import { spawn, spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { descendantPids, descendantPidsAsync, groupAlive, processAlive, taskkillArgs } from './run-gates-process-tree.ts'
import type { Gate, GateOutputChunk, GateResult, GateResultStatus } from './run-gates-types.ts'

/** Repository root the gate commands run from. */
const root = resolve(import.meta.dirname, '..')

/**
 * Execute one gate through the real shell-free child-process boundary.
 * @param gate - command and scheduler environment to execute.
 * @param signal - abort signal that terminates the whole gate process tree when
 * the aggregate fails fast; an already-aborted signal terminates it
 * immediately. A provided signal spawns the child detached so POSIX can signal
 * its process group and Windows can reach its tree through taskkill.
 * @returns the complete process outcome.
 */
export async function runGate(gate: Gate, signal?: AbortSignal): Promise<GateResult> {
  const started = performance.now()
  const output: GateOutputChunk[] = []
  let spawnError: string | undefined
  let aborted = false

  const outcome = await new Promise<{
    exitCode: number | null
    signalCode: NodeJS.Signals | null
  }>((resolveExit) => {
    const child = spawn(gate.command, gate.args, {
      cwd: root,
      env: { ...process.env, ...gate.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: signal !== undefined && process.platform !== 'win32',
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (gate.streamOutput === true) process.stdout.write(chunk)
      else output.push({ stream: 'stdout', text: chunk })
    })
    child.stderr.on('data', (chunk: string) => {
      if (gate.streamOutput === true) process.stderr.write(chunk)
      else output.push({ stream: 'stderr', text: chunk })
    })
    // Deliver one signal to the entire gate tree: the negative pid targets the
    // POSIX process group the detached child leads; Windows has no groups, so
    // taskkill walks the tree rooted at the child and force-terminates (a
    // taskkill without `/F` does not terminate console processes, which is
    // what gate commands are). Outcomes are deliberately unchecked because
    // delivery races tree exit, and a missing taskkill binary is as tolerable
    // as ESRCH. Mirrors the subprocess package's teardown contract
    // (packages/subprocess/subprocess-local/src/spawn.ts).
    const treeKill = (signalToSend: 'SIGTERM' | 'SIGKILL') => {
      const pid = child.pid
      if (pid === undefined) return
      if (process.platform === 'win32') {
        for (const args of taskkillArgs(pid, descendants)) {
          spawnSync('taskkill', args, { stdio: 'ignore' })
        }
        return
      }
      try {
        process.kill(-pid, signalToSend)
      } catch {
        // The group is gone; the direct child may still be alive alone.
        child.kill(signalToSend)
      }
      // The captured list stays valid after the group kill reparents the
      // detached descendants of a nested run-gates (the `check:node-compat`
      // and `check:ci:lint:contracts-ready` gates in ci-consumers): pids do
      // not change on reparenting, so the escalation reaches leaves that
      // ignored SIGTERM without re-enumerating.
      for (const descendantPid of descendants) {
        try {
          process.kill(descendantPid, signalToSend)
        } catch {
          // The descendant exited between the enumeration and the signal.
        }
      }
    }
    let escalation: ReturnType<typeof setTimeout> | undefined
    let terminatedAt = 0
    // Captured once at terminate and re-signalled on escalation: the group
    // kill reaps the direct child, after which its detached descendants are
    // reparented and unreachable by parent id, so the escalation cannot
    // re-enumerate them.
    let descendants: number[] = []
    let pipeDrain: ReturnType<typeof setTimeout> | undefined
    const terminate = () => {
      aborted = true
      const pid = child.pid
      // Merge while the child is still alive: re-enumerating alone would drop
      // a descendant that an exited intermediate reparented out of the parent
      // chain, and replacing the list entirely would lose the sampler's
      // last-known entries when the child already exited. Union preserves both.
      // The sampler runs on every platform (including Windows, where an
      // exited intermediate's table record vanishes and a fresh enumeration
      // cannot cross the gap), so the cache is the source of truth once the
      // child is gone.
      if (pid !== undefined && child.exitCode === null && child.signalCode === null) {
        descendants = [...new Set([...descendants, ...descendantPids(pid)])]
      }
      treeKill('SIGTERM')
      if (escalation === undefined) {
        terminatedAt = Date.now()
        // Force-kill at the deadline regardless of the direct child's exit
        // state: when the wrapper dies but a grandchild ignores SIGTERM and
        // still holds the stdio pipes, `close` has not fired and the tree must
        // still be killed. treeKill swallows an already-absent group.
        escalation = setTimeout(() => { treeKill('SIGKILL') }, 5000)
      }
      if (pipeDrain === undefined) {
        // `close` can stay pending past the direct child's exit when a
        // descendant holds the stdio write ends (escaped process group, or
        // uninterruptible I/O that keeps the SIGKILL pending). Bound the wait
        // past the 5-second SIGKILL grace and force the streams closed so
        // fail-fast settles instead of hanging to the job timeout. Only the
        // abort path arms it: on an ordinary run a gate that outlives its
        // descendants must keep waiting rather than report passed over a live
        // leak. Armed in terminate (not only at `exit`) so the window where
        // the child already exited before the abort is covered too.
        pipeDrain = setTimeout(() => {
          child.stdout.destroy()
          child.stderr.destroy()
          child.stdin.destroy()
        }, 10000)
      }
    }
    if (signal !== undefined) {
      if (signal.aborted) terminate()
      else signal.addEventListener('abort', terminate, { once: true })
    }
    // Refresh the descendant cache while the child runs, so an abort that
    // arrives after the child already exited can still reach a detached
    // descendant the child left behind: once the child is gone, its
    // descendants are reparented (POSIX) or their intermediate's table record
    // is gone (Windows), so a fresh enumeration cannot cross the gap. The
    // cache is primed at spawn and refreshed every 5 seconds, so a descendant
    // is captured once it appears in any enumeration whose parent chain is
    // still fully present in the table; the residual window is a descendant
    // that never appears in such a snapshot — created after one enumeration
    // and orphaned before the next. Enumeration is asynchronous (a slow
    // WMI/CIM call is bounded by its own 10-second timeout), so a gate's
    // output draining and exit handling are never blocked while the sampler
    // reads the process table. Fail-fast runs only; ordinary runs never
    // abort.
    let descendantSampler: ReturnType<typeof setInterval> | undefined
    if (signal !== undefined) {
      let enumerationInFlight: { cancel: () => void } | undefined
      const refreshDescendants = () => {
        const pid = child.pid
        if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
        if (enumerationInFlight !== undefined) return
        const handle = descendantPidsAsync(pid, process.platform)
        enumerationInFlight = handle
        void handle.promise.then((fresh) => {
          if (enumerationInFlight === handle) enumerationInFlight = undefined
          // Merge regardless of the child's exit state: the enumeration
          // started while the child was alive, so its snapshot is the last
          // reliable view of the tree. The child may exit (its intermediate
          // gone, its table record vanished) before the promise settles while
          // a grandchild still holds the stdio write ends and keeps `close`
          // pending — exactly when terminate needs this list.
          // Merge instead of replacing, like terminate: an intermediate that
          // exited since the last tick reparented its detached descendants
          // out of the parent chain, so a fresh enumeration alone would drop
          // them. Filter the cache to the still-executing so a long gate
          // does not accumulate stale pids; while sampler ticks still run the
          // live filter also keeps the escalation from signalling a reused
          // pid, but once ticks stop (child exited) the cache can go stale,
          // and a pid reused after that is the accepted sampling window.
          descendants = [...new Set([...descendants.filter(processAlive), ...fresh])]
        })
      }
      const cancelInFlightEnumeration = () => {
        if (enumerationInFlight !== undefined) enumerationInFlight.cancel()
        enumerationInFlight = undefined
      }
      refreshDescendants()
      descendantSampler = setInterval(refreshDescendants, 5000)
      // A gate that settles while an enumeration is still running must not
      // leave the PowerShell subprocess holding stdio handles until its own
      // timeout: stop it as soon as the child's outcome is known.
      child.once('close', cancelInFlightEnumeration)
      child.once('error', cancelInFlightEnumeration)
    }
    child.on('error', (error) => {
      if (escalation !== undefined) clearTimeout(escalation)
      if (pipeDrain !== undefined) clearTimeout(pipeDrain)
      if (descendantSampler !== undefined) clearInterval(descendantSampler)
      if (signal !== undefined) signal.removeEventListener('abort', terminate)
      spawnError = `failed to start command: ${error.message}`
      resolveExit({ exitCode: null, signalCode: null })
    })
    child.on('close', (exitCode, signalCode) => {
      if (pipeDrain !== undefined) clearTimeout(pipeDrain)
      if (descendantSampler !== undefined) clearInterval(descendantSampler)
      if (signal !== undefined) signal.removeEventListener('abort', terminate)
      if (escalation !== undefined && process.platform !== 'win32') {
        // `close` only means the direct child's stdio closed; a grandchild
        // that ignored SIGTERM and redirected its stdio can outlive it. Do
        // not settle until the process group and the captured descendants are
        // confirmed gone — the deadline SIGKILL covers members still alive at
        // the grace end — so runGate returns only once the tree is quiescent.
        const confirmGroupGone = () => {
          if (!groupAlive(child.pid) && descendants.every(descendantPid => !processAlive(descendantPid))) {
            clearTimeout(escalation)
            resolveExit({ exitCode, signalCode })
            return
          }
          if (Date.now() - terminatedAt < 8000) {
            setTimeout(confirmGroupGone, 50)
            return
          }
          // The grace ended with members still alive (e.g. uninterruptible
          // I/O that even SIGKILL cannot cut). Fail loud instead of reporting
          // a quiescent tree: the gate is recorded failed either way.
          console.error(`run-gates: gate tree not quiescent after 8s (${gate.label}).`)
          clearTimeout(escalation)
          resolveExit({ exitCode, signalCode })
        }
        confirmGroupGone()
        return
      }
      if (escalation !== undefined) clearTimeout(escalation)
      resolveExit({ exitCode, signalCode })
    })
    child.stdin.end()
  })
  const { exitCode, signalCode } = outcome

  const status: GateResultStatus = exitCode === 0 && signalCode === null && spawnError === undefined ? 'passed' : 'failed'
  const result: GateResult = {
    gate,
    status,
    durationMs: performance.now() - started,
    output,
    exitCode,
    signalCode,
  }
  result.aborted = aborted
  if (spawnError !== undefined) result.error = spawnError
  return result
}
