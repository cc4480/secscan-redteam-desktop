/** Coordinator child commands: their description, spawn, and failure decoding. */
import { spawn } from 'node:child_process'
import { lstat, rm, unlink } from 'node:fs/promises'

/** One child command owned by the coverage coordinator. */
export interface CoverageCommand {
  /** Diagnostic identity. */
  label: string
  /** Executable launched without a platform shell. */
  command: string
  /** Arguments passed to the executable. */
  args: string[]
  /** Environment additions for the child. */
  env: Record<string, string | undefined>
  /** Working directory for the child. */
  cwd: string
  /** Blob the partition must produce; absent for the merge command. */
  blobPath?: string
}

/** Observable child-process completion. */
export interface CoverageCommandResult {
  /** Numeric process status, or `null` when a signal ended the child. */
  exitCode: number | null
  /** Terminating signal, or `null` after an ordinary exit. */
  signalCode: NodeJS.Signals | null
  /** Spawn failure recorded independently from process completion. */
  error?: string
  /** Bounded combined stdout/stderr tail repeated when the command fails. */
  outputTail?: string
}

/** Execute one coordinator command with inherited output. */
export type CoverageCommandRunner = (command: CoverageCommand) => Promise<CoverageCommandResult>

/** Spawn one pnpm-backed command without a platform shell. */
export function runCoverageCommand(command: CoverageCommand): Promise<CoverageCommandResult> {
  return new Promise((resolveCommand) => {
    let outputTail = ''
    const env = { ...process.env }
    for (const [name, value] of Object.entries(command.env)) {
      if (value === undefined) Reflect.deleteProperty(env, name)
      else env[name] = value
    }
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      process.stdout.write(chunk)
      outputTail = appendOutputTail(outputTail, chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      process.stderr.write(chunk)
      outputTail = appendOutputTail(outputTail, chunk)
    })
    child.once('error', (error: Error) => {
      resolveCommand({ exitCode: null, signalCode: null, error: error.message, outputTail })
    })
    child.once('close', (exitCode, signalCode) => {
      resolveCommand({ exitCode, signalCode, outputTail })
    })
  })
}

function appendOutputTail(previous: string, chunk: string): string {
  const combined = previous + chunk
  return combined.length <= 65_536 ? combined : combined.slice(-65_536)
}

/** Whether a completed child failed by exit status, signal, or spawn error. */
export function commandFailed(result: CoverageCommandResult): boolean {
  return result.exitCode !== 0 || result.signalCode !== null || result.error !== undefined
}

/** Render the failure facts of one command result for a diagnostic line. */
export function commandFailureReason(result: CoverageCommandResult): string {
  const facts = [
    result.error,
    result.exitCode === null ? undefined : `exit ${result.exitCode}`,
    result.signalCode === null ? undefined : `signal ${result.signalCode}`,
  ].filter((fact): fact is string => fact !== undefined)
  return facts.join(', ') || 'no exit code or signal'
}

/** Remove a tree the coordinator owns, tolerating a missing path. */
export async function removeOwnedTree(path: string): Promise<void> {
  const metadata = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  })
  if (metadata === undefined) return
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    await unlink(path)
    return
  }
  await rm(path, { recursive: true, force: true })
}
