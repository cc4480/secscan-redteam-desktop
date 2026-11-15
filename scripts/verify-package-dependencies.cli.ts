/** Command-line entry: check the dependency policy and repair manifests on request. */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { writeModuleGraph } from './gen-module-graph.ts'
import { formatManagedRuntimeDependencies, formatPeerRequiredRuntimeDependencies } from './verify-package-dependencies.expected.ts'
import { readPackageDependencyState } from './verify-package-dependencies.facts.ts'
import { fixPackageDependencies } from './verify-package-dependencies.repair.ts'
import { GATE } from './verify-package-dependencies.shared.ts'
import { collectPackageDependencyViolations } from './verify-package-dependencies.violations.ts'

function refreshPnpmLockfile(root: string): void {
  const result = spawnSync(
    'pnpm',
    ['install', '--lockfile-only', '--ignore-scripts', '--no-frozen-lockfile'],
    { cwd: root, shell: process.platform === 'win32', stdio: 'inherit' },
  )
  if (result.error !== undefined) throw new Error(`could not refresh pnpm-lock.yaml: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`pnpm lockfile refresh exited with status ${String(result.status)}`)
}

/** Run the dependency gate, repairing manifests and the lockfile when asked. */
export function main(): void {
  const root = resolve(import.meta.dirname, '..')
  let state = readPackageDependencyState(root)
  const fix = process.argv.includes('--fix')
  if (fix) {
    if (state.policyViolations.length > 0) {
      console.error(`${GATE}: --fix skipped because dependency policy review failed.`)
    } else {
      const changed = fixPackageDependencies(root, state)
      console.log(`${GATE}: fixed ${String(changed.length)} manifest(s).`)
      refreshPnpmLockfile(root)
      const graphChanges = writeModuleGraph(root)
      console.log(
        `${GATE}: refreshed pnpm-lock.yaml and wrote ${String(graphChanges.length)} module-graph artifact(s).`,
      )
      state = readPackageDependencyState(root)
    }
  }
  const violations = collectPackageDependencyViolations(state)
  if (violations.length > 0) {
    console.error(`${GATE}: ${String(violations.length)} violation(s):`)
    for (const violation of violations) console.error(`  ${violation}`)
    process.exitCode = 1
    return
  }
  const roles = Object.groupBy(state.facts, fact => fact.role)
  console.log(
    `${GATE}: ${String(state.facts.length)} package(s) match the published dependency policy`
    + ` (${String(roles['client-only']?.length ?? 0)} Client-only,`
    + ` ${String(roles['client-host']?.length ?? 0)} Client/Host,`
    + ` ${String(roles['configured-host']?.length ?? 0)} configured Host).`,
  )
  if (fix) {
    for (const line of formatManagedRuntimeDependencies(state)) console.log(line)
    for (const line of formatPeerRequiredRuntimeDependencies(state)) console.log(line)
  }
}
