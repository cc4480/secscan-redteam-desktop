/** Scratch-repository stand-ins for the Lefthook binary and the pairing probe. */

import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = fileURLToPath(new URL('.', import.meta.url))
const tsxPackageDirectory = dirname(fileURLToPath(import.meta.resolve('tsx/package.json')))

/**
 * Renders the fake Lefthook binary every fixture installs.
 * @returns the source of a Node script that only honours `install --force`.
 */
export function fakeLefthookSource(): string {
  return `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

if (process.argv.slice(2).join(' ') !== 'install --force') process.exit(64)
const rootOutput = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
const root = rootOutput.endsWith('\\n') ? rootOutput.slice(0, -1) : rootOutput
const forbiddenConfigKey = process.env.DSH_TEST_FORBIDDEN_GIT_CONFIG_KEY
if (forbiddenConfigKey !== undefined) {
  try {
    execFileSync('git', ['config', '--get', forbiddenConfigKey], { encoding: 'utf8' })
    process.exit(92)
  } catch (error) {
    if (error === null || typeof error !== 'object' || !('status' in error) || error.status !== 1) throw error
  }
}
const hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim()
mkdirSync(hooksPath, { recursive: true })
const running = join(hooksPath, '.fake-lefthook-running')
try {
  writeFileSync(running, String(process.pid), { flag: 'wx' })
} catch {
  process.exit(91)
}
const delay = Number(process.env.DSH_TEST_LEFTHOOK_DELAY_MS ?? 0)
if (delay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
const replaceLockPath = process.env.DSH_TEST_LEFTHOOK_REPLACE_LOCK_PATH
if (replaceLockPath !== undefined) writeFileSync(replaceLockPath, 'replacement owner\\n')
const shouldFail = process.env.DSH_TEST_LEFTHOOK_FAIL === '1'
if (!shouldFail) {
  const binary = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'lefthook.cmd' : 'lefthook')
  const config = readFileSync(join(root, 'lefthook.yml'), 'utf8').trim()
  const hook = \`#!/bin/sh\\n# root=\${root}\\n# binary=\${binary}\\n# config=\${config}\\nexit 0\\n\`
  for (const name of ['pre-commit', 'pre-merge-commit', 'pre-push']) writeFileSync(join(hooksPath, name), hook, { mode: 0o755 })
}
if (existsSync(running)) unlinkSync(running)
if (process.env.DSH_TEST_LEFTHOOK_BREAK_WORKTREE_CONFIG === '1') {
  const configPath = execFileSync('git', ['rev-parse', '--git-path', 'config.worktree'], { encoding: 'utf8' }).trim()
  writeFileSync(configPath, '[invalid\\n')
}
if (shouldFail) process.exit(77)
`
}

/**
 * Installs the fake Lefthook binary and its platform shim into a fixture root.
 * @param root - worktree root receiving `node_modules/.bin`.
 * @returns nothing.
 */
export function installFakeLefthook(root: string): void {
  const binDirectory = join(root, 'node_modules/.bin')
  mkdirSync(binDirectory, { recursive: true })
  writeFileSync(join(binDirectory, 'fake-lefthook.mjs'), fakeLefthookSource())
  if (process.platform === 'win32') {
    writeFileSync(
      join(binDirectory, 'lefthook.cmd'),
      `@echo off\r\n"${process.execPath}" "%~dp0\\fake-lefthook.mjs" %*\r\n`,
    )
    return
  }
  const shim = join(binDirectory, 'lefthook')
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-lefthook.mjs" "$@"\n`)
  chmodSync(shim, 0o755)
}

/**
 * Links this repository's scripts and tsx package beside a fixture so the
 * pairing-driver probe resolves.
 * @param root - worktree root receiving the two links.
 * @returns nothing.
 */
export function installPairingProbeFixture(root: string): void {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  symlinkSync(scriptsDirectory, join(root, 'scripts'), linkType)
  symlinkSync(tsxPackageDirectory, join(root, 'node_modules/tsx'), linkType)
}
