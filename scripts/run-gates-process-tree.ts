/**
 * Live process-table inspection for one gate tree: liveness probes, descendant
 * enumeration, and the Windows termination arguments.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { collectDescendants, parsePidPpidLines } from './run-gates-pid-tables.ts'

/**
 * Parse the state, parent, and process-group fields from a `/proc/<pid>/stat`
 * line. The comm field may contain spaces and parentheses, so the state starts
 * after the last closing parenthesis.
 * @param stat - one `/proc/<pid>/stat` line.
 * @returns state, parent pid, and process-group pid; undefined when truncated.
 */
export function procStatFields(stat: string): { state: string; ppid: number; pgrp: number } | undefined {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  const state = fields[0]
  const ppid = fields[1]
  const pgrp = fields[2]
  if (state === undefined || ppid === undefined || pgrp === undefined) return undefined
  return { state, ppid: Number(ppid), pgrp: Number(pgrp) }
}

/**
 * Whether one process is still executing. Zombies (state `Z`) do not count:
 * they are dead records awaiting reaping, and kill(pid, 0) would report them
 * as alive. Linux reads /proc/<pid>/stat to distinguish; other platforms fall
 * back to the signal probe.
 * @param pid - the process to probe.
 * @returns whether the process is still executing.
 */
export function processAlive(pid: number): boolean {
  if (process.platform === 'linux') {
    try {
      const parsed = procStatFields(readFileSync(`/proc/${pid}/stat`, 'utf8'))
      return parsed !== undefined && parsed.state !== 'Z'
    } catch {
      return false
    }
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Whether any member of the child's POSIX process group is still executing.
 * Zombie entries (state `Z`) do not count: they are dead records awaiting
 * reaping, and the kill(-pid, 0) group probe would report them as alive.
 * Linux enumerates /proc to distinguish after a fast-path group probe; other
 * POSIX platforms fall back to the probe alone.
 * @param pid - the group leader's pid; undefined or non-positive means the
 * spawn failed and nothing is alive.
 * @returns whether any group member is still executing.
 */
export function groupAlive(pid: number | undefined): boolean {
  if (pid === undefined || pid <= 0) return false
  if (process.platform === 'linux') {
    try {
      process.kill(-pid, 0)
    } catch {
      // ESRCH: the group has no entries at all.
      return false
    }
    try {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue
        try {
          const parsed = procStatFields(readFileSync(`/proc/${entry}/stat`, 'utf8'))
          if (parsed !== undefined && parsed.pgrp === pid && parsed.state !== 'Z') return true
        } catch {
          // The process exited mid-scan; it is not a live member.
        }
      }
      return false
    } catch {
      return false
    }
  }
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * The pids of every transitive descendant of `root`, read from the live
 * process table. Linux walks /proc/<pid>/stat parent fields; other platforms
 * parse `ps` (POSIX) or the CIM process table (Windows) output. This is one
 * snapshot, not the full tree-ownership mechanism: terminate and the sampler
 * rely on the 5-second cache to cross an intermediate that exited between
 * ticks (reparented on POSIX, table record gone on Windows), so a single
 * enumeration reaches only the descendants whose parent chain is still fully
 * present in the table.
 * @param root - the pid whose descendants are wanted.
 * @returns descendant pids in breadth-first order; empty on enumeration failure.
 */
export function descendantPids(root: number): number[] {
  if (root <= 0) return []
  if (process.platform === 'linux') {
    const rows: Array<[number, number]> = []
    try {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue
        try {
          const parsed = procStatFields(readFileSync(`/proc/${entry}/stat`, 'utf8'))
          if (parsed !== undefined) rows.push([Number(entry), parsed.ppid])
        } catch {
          // The process exited mid-scan; skip it.
        }
      }
    } catch {
      return []
    }
    return collectDescendants(root, rows)
  }
  let ps: { error?: Error; stdout: string }
  if (process.platform === 'win32') {
    // taskkill /T covers the tree only while the root is alive; once the
    // direct child exits (a descendant still holding the stdio write ends
    // keeps `close` pending), abort must reach the survivors from a fresh
    // enumeration. Windows keeps the exited parent's pid in its descendants'
    // parent column, so this walk still finds the whole tree. A hung
    // PowerShell (WMI/CIM service trouble) must not stall the abort path
    // indefinitely, so the enumeration is bounded.
    ps = spawnSync('powershell', processTableArgs('win32'), { encoding: 'utf8', timeout: 10000 })
  } else {
    ps = spawnSync('ps', processTableArgs('posix'), { encoding: 'utf8' })
  }
  if (ps.error !== undefined) return []
  return collectDescendants(root, parsePidPpidLines(ps.stdout))
}

/**
 * The process-table enumeration command for one platform. Windows queries the
 * CIM provider through PowerShell (each line `pid ppid`); other platforms use
 * `ps -axo pid=,ppid=`.
 * @param platform - the target platform.
 * @returns the command arguments to enumerate every live process's pid/ppid.
 */
export function processTableArgs(platform: 'win32' | 'posix'): string[] {
  if (platform === 'win32') {
    return ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }']
  }
  return ['-axo', 'pid=,ppid=']
}

/**
 * Asynchronous descendant enumeration, so a slow WMI/CIM call (bounded by a
 * 10-second timeout) cannot block the event loop: the sampler runs it while
 * the gate's output streams and exit handling must keep flowing. Returns the
 * same descendant list as {@link descendantPids}; used by the fail-fast
 * sampler only, never on the abort path (which needs the synchronous walk to
 * capture the tree before any member exits).
 * @param root - the pid whose descendants are wanted.
 * @param platform - the platform whose table the enumeration reads.
 * @returns a promise of descendant pids in breadth-first order; empty on
 * enumeration failure.
 */
export function descendantPidsAsync(root: number, platform: NodeJS.Platform): { promise: Promise<number[]>; cancel: () => void } {
  if (root <= 0 || platform === 'linux') {
    // The /proc walk is synchronous inside the async wrapper so the sampler
    // keeps the same contract on every platform; /proc reads are fast and
    // need no subprocess, and a completed enumeration needs no cancellation.
    return { promise: Promise.resolve(descendantPids(root)), cancel: () => {} }
  }
  const [command, args] = platform === 'win32'
    ? ['powershell', processTableArgs('win32')]
    : ['ps', processTableArgs('posix')]
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: platform === 'win32' ? 10000 : undefined,
  })
  child.stdout.setEncoding('utf8')
  let stdout = ''
  let settled = false
  let settle!: (value: number[]) => void
  const promise = new Promise<number[]>((resolve) => { settle = resolve })
  const finish = (value: number[]) => {
    if (settled) return
    settled = true
    // The enumeration completed (or was cancelled): stop the subprocess so
    // the gate does not wait on its stdio handles.
    child.kill('SIGTERM')
    settle(value)
  }
  child.stdout.on('data', (chunk: string) => { stdout += chunk })
  child.on('error', () => { finish([]) })
  child.on('close', () => { finish(collectDescendants(root, parsePidPpidLines(stdout))) })
  return {
    promise,
    cancel: () => { finish([]) },
  }
}

/**
 * The taskkill invocations that terminate one Windows gate tree. The direct
 * child leads, because a live `taskkill /T` walks its whole subtree in one
 * call; each captured descendant follows individually, because when the root
 * already exited (a descendant holding the stdio write ends keeps `close`
 * pending) `taskkill /T` rooted at the dead pid finds nothing — Windows never
 * reparents, so the ppid chain captured at terminate still reaches the whole
 * tree, and `/T` lets a surviving intermediate carry its own subtree. A pid
 * that exited between capture and termination is as tolerable as ESRCH on
 * POSIX: taskkill reports a nonzero status that is deliberately unchecked.
 * @param rootPid - the direct child's pid.
 * @param descendants - the captured descendant pids.
 * @returns one `taskkill` argument list per pid, in termination order.
 */
export function taskkillArgs(rootPid: number, descendants: number[]): string[][] {
  return [rootPid, ...descendants].map(pid => ['/PID', String(pid), '/T', '/F'])
}
