import { build } from 'tsdown'
import type { TsdownBundle } from 'tsdown'

/**
 * Start the tsdown watch build used by `pnpm run dev:web`.
 * @param root - repository or fixture root passed to tsdown.
 * @param pluginDirs - workspace-relative package directories to watch.
 * @param pollInterval - optional source-watcher polling interval in milliseconds.
 * @returns live bundles after every watcher has completed its initial build.
 */
export async function watchClientPlugins(
  root: string,
  pluginDirs: readonly string[],
  pollInterval?: number,
): Promise<TsdownBundle[]> {
  let resolveInitialBuilds: (() => void) | undefined
  const initialBuilds = new Promise<void>((resolve) => { resolveInitialBuilds = resolve })
  const initialized = new WeakSet<object>()
  const readiness: { expectedBuilds?: number; initializedBuilds: number } = { initializedBuilds: 0 }
  const bundles = await build({
    cwd: root,
    workspace: [...pluginDirs],
    watch: true,
    hooks: {
      'build:done': ({ options }) => {
        if (initialized.has(options)) return
        initialized.add(options)
        readiness.initializedBuilds += 1
        if (
          readiness.expectedBuilds !== undefined
          && readiness.initializedBuilds >= readiness.expectedBuilds
        ) resolveInitialBuilds?.()
      },
    },
    ...pollInterval !== undefined
      ? { inputOptions: { watch: { watcher: { usePolling: true, pollInterval } } } }
      : {},
  })
  readiness.expectedBuilds = bundles.length
  if (readiness.initializedBuilds >= readiness.expectedBuilds) resolveInitialBuilds?.()
  await initialBuilds
  return bundles
}
