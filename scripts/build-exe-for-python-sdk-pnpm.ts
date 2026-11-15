/**
 * pnpm invocation resolution and subprocess execution for the Python SDK executable builder.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import type { BuildCli } from './build-exe-for-python-sdk-cli.ts'
import { root } from './build-exe-for-python-sdk-config.ts'

/**
 * Resolve the pnpm invocation arguments through a JavaScript entrypoint when available.
 * @param args - pnpm arguments.
 * @returns the executable and its arguments.
 */
export function pnpmInvocation(args: string[]): [command: string, args: string[]] {
  const entrypoint = process.env.npm_execpath?.trim()
  if (entrypoint !== undefined && entrypoint !== '') {
    const extension = extname(entrypoint).toLowerCase()
    if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
      return [process.execPath, [entrypoint, ...args]]
    }
    if (extension !== '.cmd') return [entrypoint, args]
  }
  const home = process.env.PNPM_HOME?.trim()
  if (home !== undefined && home !== '') {
    const packageBin = resolve(home, '..', 'pnpm', 'bin')
    for (const filename of ['pnpm.mjs', 'pnpm.cjs']) {
      const candidate = resolve(packageBin, filename)
      if (existsSync(candidate)) return [process.execPath, [candidate, ...args]]
    }
  }
  if (process.platform === 'win32') {
    throw new Error('build-exe-for-python-sdk: pnpm must expose a JavaScript entrypoint through npm_execpath or PNPM_HOME on Windows.')
  }
  return ['pnpm', args]
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
export function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Run one subprocess with inherited stdio. Spawn and non-zero-exit errors
 * include the command; dry runs only print it.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param label - the step name used in logs and error messages.
 * @param command - the executable.
 * @param args - its arguments.
 */
export async function runCommand(cli: BuildCli, label: string, command: string, args: string[]): Promise<void> {
  const printable = formatCommand(command, args)
  if (cli.dryRun) {
    console.log(`build-exe-for-python-sdk: [dry-run] ${printable}`)
    return
  }
  console.log(`build-exe-for-python-sdk: ${label}: ${printable}`)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      // Artifact builds must not mutate or validate a developer's Git hooks.
      env: { ...process.env, CI: 'true' },
    })
    child.once('error', (error) => {
      reject(new Error(`build-exe-for-python-sdk: ${label} failed to spawn: ${error.message} (${printable})`))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
      reject(new Error(`build-exe-for-python-sdk: ${label} failed (${cause}): ${printable}`))
    })
  })
}

/**
 * Run pnpm through its JavaScript entrypoint when the caller supplies one.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param label - the step name used in logs and error messages.
 * @param args - pnpm arguments.
 */
export async function runPnpm(cli: BuildCli, label: string, args: string[]): Promise<void> {
  const [command, invocationArgs] = pnpmInvocation(args)
  await runCommand(cli, label, command, invocationArgs)
}
