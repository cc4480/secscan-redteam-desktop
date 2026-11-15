/**
 * Native msfconsole transport: one command per invocation.
 *
 * Measured on a real Metasploit 6.5.3-dev install (Windows, `C:\metasploit`):
 *
 *  - `msfconsole -q -x "<cmd>; exit"` works and is the ONLY viable form here.
 *  - A persistent console driven over stdin does NOT work: writing commands
 *    before the prompt loses them, and writing them after `msf >` appears is
 *    ignored too. Two probes established that, so this module does not pretend
 *    a long-lived session is available.
 *  - Startup cost is real: 147s on the first run of an install (database and gem
 *    initialisation) and ~29s warm. Every command therefore pays that boot, which
 *    is what the timeout handling below is sized for.
 *  - The Windows entry point is a `.bat`, and Node cannot spawn one directly
 *    (`spawn EINVAL`); it has to go through `cmd.exe /c`.
 *
 * Consequently this transport is a fallback for a host with no `msfrpcd`, not a
 * free replacement: the RPC daemon answers in milliseconds because it pays the
 * boot once, and this pays it per command.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * Kill a console process AND its children.
 *
 * On Windows the spawn target is `cmd.exe`, which starts the Ruby interpreter as a
 * child. `child.kill()` terminates only `cmd.exe`, so the actual Metasploit process
 * survives as an orphan — observed directly: three probes left `msfconsole` Ruby
 * processes running for over twenty minutes after the caller had exited. A
 * per-timeout leak of that size is not acceptable, so the tree is killed explicitly.
 * @param child - the spawned wrapper process.
 */
function killConsoleTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch { /* the process may already be gone */ }
    return
  }
  try { child.kill('SIGKILL') } catch { /* the process may already be gone */ }
}

/** Default warm-startup budget, generously above the measured ~29s. */
export const DEFAULT_CONSOLE_TIMEOUT_MS = 180_000

/** Well-known Windows install locations, after the environment override. */
const WINDOWS_DEFAULTS = [
  'C:\\metasploit\\framework\\bin\\msfconsole.bat',
  'C:\\metasploit-framework\\bin\\msfconsole.bat',
]

/** Outcome of one console command. */
export interface ConsoleRunResult {
  /** Whether the command produced output and exited without a timeout. */
  readonly ok: boolean
  /** Console output with ANSI escapes removed. */
  readonly output: string
  /** Process exit code, or undefined when it was killed. */
  readonly code?: number
  /** Set when the run timed out or failed to spawn. */
  readonly failure?: string
}

/** Strip ANSI SGR sequences and Ruby's deprecation chatter from console output. */
export function cleanConsoleOutput(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .filter(line =>
      !/warning: .*(deprecated|Gemfile|gemspec)/i.test(line)
      // The deprecation notice continues on the next line, which carries no
      // "warning:" prefix of its own.
      && !/^You can add .* to silence this warning/i.test(line))
    .join('\n')
}

/**
 * Resolve the msfconsole executable.
 * @param env - process environment; `REDTEAM_MSF_CONSOLE_BIN` wins when set.
 * @returns the configured path, the first well-known Windows path that exists, or `msfconsole`.
 */
export function resolveMsfConsoleBinary(env: NodeJS.ProcessEnv): string {
  const configured = env['REDTEAM_MSF_CONSOLE_BIN']?.trim()
  if (configured) return configured
  if (process.platform === 'win32') {
    for (const candidate of WINDOWS_DEFAULTS) {
      if (existsSync(candidate)) return candidate
    }
    return 'msfconsole.bat'
  }
  return 'msfconsole'
}

/**
 * Run ONE command through `msfconsole -q -x` and return its output.
 *
 * The command is joined into the `-x` script followed by `exit`, so the console
 * always terminates; a command that leaves an interactive prompt (an exploit that
 * opens a session) therefore ends when the console does, which suits the
 * one-shot read model.
 * @param binary - executable path, normally from {@link resolveMsfConsoleBinary}.
 * @param command - the msfconsole command line, e.g. `use auxiliary/scanner/portscan/tcp; show options`.
 * @param timeoutMs - boot and execution budget; see {@link DEFAULT_CONSOLE_TIMEOUT_MS}.
 * @returns the captured output and how the run ended.
 */
export function runConsoleOnce(
  binary: string,
  command: string,
  timeoutMs: number = DEFAULT_CONSOLE_TIMEOUT_MS,
): Promise<ConsoleRunResult> {
  const script = `${command}; exit`
  const windows = process.platform === 'win32'
  const file = windows ? 'cmd.exe' : binary
  const args = windows ? ['/c', binary, '-q', '-x', script] : ['-q', '-x', script]

  return new Promise<ConsoleRunResult>(resolve => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: ConsoleRunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      killConsoleTree(child)
      finish({ ok: false, output: cleanConsoleOutput(stdout), failure: `console timed out after ${Math.round(timeoutMs / 1000)}s` })
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error: Error) => {
      finish({ ok: false, output: '', failure: `console failed to start: ${error.message}` })
    })
    child.on('close', (code: number | null) => {
      const output = cleanConsoleOutput(stdout)
      finish({
        ok: code === 0,
        output,
        ...code === null ? {} : { code },
        ...code === 0 ? {} : { failure: `console exited ${String(code)}: ${cleanConsoleOutput(stderr).trim().split('\n')[0] ?? ''}` },
      })
    })
  })
}
