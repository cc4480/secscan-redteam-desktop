import { execa } from 'execa'
import { repoRoot } from './dev-web-constants.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'
import type { StageSupervisor } from './dev-web-supervisor.ts'

/**
 * Spawn one long-lived stage with inherited stdio and hand it to the supervisor.
 * @param supervisor - owner that reports an unexpected exit and stops the stage on shutdown.
 * @param name - command label used in diagnostics.
 * @param command - executable, resolved from the workspace bins when `local` is set.
 * @param args - command arguments.
 * @param local - whether to resolve `command` from the workspace's installed bins.
 */
export function spawnStage(
  supervisor: StageSupervisor,
  name: string,
  command: string,
  args: readonly string[],
  local: boolean,
): void {
  const child = execa(command, [...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    preferLocal: local,
    reject: false,
  })
  supervisor.add({
    name,
    exited: child.then(result => result.exitCode ?? null),
    kill(signal) { child.kill(signal) },
  })
}

/**
 * Run the complete repository build with the launch environment untouched:
 * `scripts/build.ts` samples the public client values itself.
 * @returns the build's exit code, or null when a signal ended it.
 */
export async function runBuild(): Promise<number | null> {
  const invocation = pnpmInvocation(['run', 'build'])
  const result = await execa(invocation.command, invocation.args, { cwd: repoRoot, stdio: 'inherit', reject: false })
  return result.exitCode ?? null
}
