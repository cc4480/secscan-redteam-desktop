/** npm invocation and listener lifecycle for the benchmark's local registry. */

import { writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { runCommandWithTimeout } from './benchmark-npm-resolution-process.ts'

/**
 * Select the npm executable for the current platform.
 * @returns The npm command name.
 */
export function npmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/**
 * Bind a server to an available loopback port.
 * @param server - Server to listen with.
 * @returns The bound TCP port.
 */
export function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('local registry did not expose a TCP port'))
        return
      }
      resolveListen(address.port)
    })
  })
}

/**
 * Close a server and settle once every connection is released.
 * @param server - Server to close.
 * @returns Completion of the close.
 */
export function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error === undefined) resolveClose()
      else reject(error)
    })
  })
}

/**
 * Run npm's metadata-only install against the benchmark registry.
 * @param cwd - Consumer directory holding the generated manifest.
 * @param registry - Base URL of the benchmark registry.
 * @param timeoutMs - Hard wall-clock limit for the npm child process.
 * @returns Timing, combined output, and whether timeout handling began.
 */
export async function runNpm(
  cwd: string,
  registry: string,
  timeoutMs: number,
): Promise<{ durationMs: number; output: string; timedOut: boolean }> {
  const npmrc = join(cwd, '.npmrc')
  const globalNpmrc = join(cwd, '.npmrc-global')
  writeFileSync(npmrc, `registry=${registry}\n@deepseek-ai:registry=${registry}\n`)
  writeFileSync(globalNpmrc, '')
  const inheritedEnvironment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !name.toLowerCase().startsWith('npm_config_')))
  const result = await runCommandWithTimeout(npmExecutable(), [
    'install',
    '--package-lock-only',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    '--include=peer',
    '--install-strategy=hoisted',
    '--legacy-peer-deps=false',
    `--registry=${registry}`,
  ], {
    cwd,
    env: {
      ...inheritedEnvironment,
      npm_config_cache: join(cwd, '.npm-cache'),
      npm_config_globalconfig: globalNpmrc,
      npm_config_userconfig: npmrc,
      npm_config_update_notifier: 'false',
    },
    timeoutMs,
  })
  if (result.timedOut) return result
  if (result.status !== 0) {
    throw new Error(`npm install exited ${String(result.status)} after ${result.durationMs.toFixed(0)} ms\n${result.output.trim()}`)
  }
  return result
}
