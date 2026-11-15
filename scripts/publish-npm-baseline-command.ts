/** Child-process execution and terminal prompts for the npm baseline pipeline. */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'

/** Captured result of one child process. */
export interface CommandResult {
  status: number
  stdout: string
  stderr: string
}

/** Runs child processes without involving a command shell. */
export class CommandRunner {
  run(
    command: string,
    args: string[],
    cwd: string,
    environment: NodeJS.ProcessEnv = process.env,
  ): void {
    const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      throw new Error(`${formatCommand(command, args)} exited with status ${String(result.status)}`)
    }
  }

  capture(
    command: string,
    args: string[],
    cwd: string,
    environment: NodeJS.ProcessEnv = process.env,
  ): string {
    const result = this.result(command, args, cwd, environment)
    if (result.status !== 0) throw commandFailure(command, args, result)
    return result.stdout.trim()
  }

  result(
    command: string,
    args: string[],
    cwd: string,
    environment: NodeJS.ProcessEnv = process.env,
  ): CommandResult {
    const result: SpawnSyncReturns<string> = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    })
    if (result.error !== undefined) throw result.error
    return {
      status: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }
}

/**
 * Build the error that carries one failed command's captured output.
 * @param command - the executable that ran.
 * @param args - the arguments it received.
 * @param result - its captured result.
 * @returns the error naming the exit status and output.
 */
export function commandFailure(command: string, args: string[], result: CommandResult): Error {
  const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
  return new Error(
    `${formatCommand(command, args)} exited with status ${result.status}${detail === '' ? '' : `\n${detail}`}`,
  )
}

/**
 * Render one command for an error message.
 * @param command - the executable that ran.
 * @param args - the arguments it received.
 * @returns the quoted command line.
 */
export function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(value => JSON.stringify(value)).join(' ')
}

/**
 * Render one command for the caller to paste into a shell.
 * @param command - the executable to run.
 * @param args - the arguments to pass.
 * @returns the shell-quoted command line.
 */
export function formatCopyableCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteShellArgument).join(' ')
}

/**
 * Quote one argument so a POSIX shell reproduces it literally.
 * @param value - the argument to quote.
 * @returns the argument, quoted only when it needs it.
 */
export function quoteShellArgument(value: string): string {
  if (/^[\w./:@=+-]+$/.test(value)) return value
  const singleQuote = String.fromCodePoint(39)
  const escapedSingleQuote = `${singleQuote}"${singleQuote}"${singleQuote}`
  return `${singleQuote}${value.replaceAll(singleQuote, escapedSingleQuote)}${singleQuote}`
}

/** npm client environment with the caller's user agent removed. */
export function npmClientEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.npm_config_user_agent
  delete environment.NPM_CONFIG_USER_AGENT
  return environment
}

/**
 * Build the environment for probing an installed bundle outside the workspace.
 * @param consumerRoot - root of the isolated consumer directory.
 * @returns the environment for the shipped entry point.
 */
export function installedArtifactEnvironment(consumerRoot: string): NodeJS.ProcessEnv {
  const environment = npmClientEnvironment()
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  environment.DSH_HOME = resolve(consumerRoot, '.dsh')
  environment.DSH_AGENTS_HOME = resolve(consumerRoot, '.agents')
  environment.DSH_TELEMETRY_DISABLED = '1'
  environment.DEEPSEEK_API_KEY = 'keyless-installed-web-no-call'
  environment.LANG = 'en_US.UTF-8'
  environment.LC_ALL = 'en_US.UTF-8'
  environment.LC_CTYPE = 'en_US.UTF-8'
  environment.TERM = 'xterm-256color'
  environment.COLUMNS = '100'
  environment.LINES = '30'
  delete environment.COLORTERM
  return environment
}

/**
 * Wait for the operator to press Enter on an interactive terminal.
 * @param prompt - the question to display.
 * @param nonInteractiveError - message used when no terminal is attached.
 * @param cancellationError - message used when the operator types anything.
 */
export async function confirmEnter(
  prompt: string,
  nonInteractiveError: string,
  cancellationError: string,
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(nonInteractiveError)
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await readline.question(prompt)
    if (answer !== '') throw new Error(cancellationError)
  } finally {
    readline.close()
  }
}
