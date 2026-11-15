/**
 * The Web development loop: build once, serve through `dsh web`, and keep every
 * browser-side artifact rebuilt on source edits, in one terminal.
 *
 * Stages, in order: `pnpm run build` (skipped by `--skip-build`), three
 * long-lived watchers, then `dsh web` (skipped by `--no-serve`). The watchers
 * exist because the compile shell links built lib products rather than
 * sources: `tsc -b tsconfig.client.json --watch` emits `lib/types` (the tsdown
 * lib entries are that emit, not `src`), tsdown watch bundles `lib/index.js`
 * and `lib/client.js`, and `vite build --watch` rewrites `apps/web/dist`, which
 * `dsh web` serves. A missing watcher does not fail — it silently shows the
 * previous artifact, so an edit appears to do nothing; any stage exiting on its
 * own therefore stops the loop with exit code 1.
 *
 * Reload signaling is not this script's business — the host webserver
 * stat-polls the bundles it serves and broadcasts `rebuilt` frames itself, so
 * any process that rewrites `lib/client.js` files triggers reloads.
 *
 * MUST NOT run beside `pnpm run build`: both write the same `lib/` and
 * `apps/web/dist/` trees. The build stage here finishes before any watcher starts.
 *
 * Usage: `pnpm run dev:web [--skip-build] [--no-serve] [--poll[=ms]] [dsh web arguments]`.
 * `--skip-build` requires the artifact tree from a prior complete build: every
 * watcher is incremental over the previous stage's output and none of them
 * bootstraps a missing tree. `--no-serve` keeps only the watchers, for a
 * `dsh web` started elsewhere. `--poll` switches the source watchers to polling
 * (default 500ms): network mounts (weka) deliver no inotify events, so native
 * watching sees the initial build only and never a source change. Polling has
 * to reach tsc too — a native-watching tsc never re-emits `lib/types`, which
 * strands the other two stages on stale input.
 *
 * Shutdown: Ctrl+C reaches every stage through the terminal's process group, so
 * the script only waits for them and escalates survivors; SIGTERM is addressed
 * to this process alone and is forwarded once. The exit code is 130 after
 * SIGINT, 0 after SIGTERM, and 1 when a stage exited on its own.
 *
 * Each package keeps its own tsdown.config.ts untouched: this script layers
 * `watch` through API-level inline config (tsdown workspace mode fills inline
 * keys under each package's file config, and no package config defines it).
 */
import { CLIENT_BUILD_PROFILE_SELECTOR } from './client-build-environment.ts'
import type { DevWebArguments } from './dev-web-arguments.ts'
import { parseDevWebArguments } from './dev-web-arguments.ts'
import { CLIENT_TYPE_PROGRAM, SHELL_PACKAGE, repoRoot } from './dev-web-constants.ts'
import { discoverLibraryDirs, discoverPluginDirs } from './dev-web-discovery.ts'
import { devWebBuildEnvironment } from './dev-web-environment.ts'
import { runBuild, spawnStage } from './dev-web-launch.ts'
import { STOP_GRACE_MS, StageSupervisor } from './dev-web-supervisor.ts'
import { watchClientPlugins } from './dev-web-watch.ts'

/**
 * Run the loop described in this module's header until a stage fails or a
 * shutdown signal arrives, then tear every stage down.
 * @returns never — every exit path terminates the process with the loop's exit code.
 */
export async function runDevWebMain(): Promise<never> {
  let options: DevWebArguments
  try {
    options = parseDevWebArguments(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error('dev-web: usage: pnpm run dev:web [--skip-build] [--no-serve] [--poll[=ms]] [dsh web arguments]')
    process.exit(1)
  }

  // Shutdown is requested once, by a terminal signal or by a stage exiting on
  // its own; `signal` stays unset for SIGINT because the terminal's process
  // group already delivered it to every stage.
  const shutdown = Promise.withResolvers<number>()
  const requested: { code?: number; signal?: NodeJS.Signals } = {}
  const shutdownRequested = (): boolean => requested.code !== undefined
  const requestShutdown = (code: number, signal: NodeJS.Signals | undefined): void => {
    if (shutdownRequested()) return
    requested.code = code
    if (signal !== undefined) requested.signal = signal
    shutdown.resolve(code)
  }
  const supervisor = new StageSupervisor((stage, code) => {
    console.error(`dev-web: ${stage} exited (code ${String(code)}); stopping the other stages`)
    requestShutdown(1, 'SIGTERM')
  })
  // Persistent listeners, not `once`: the tsdown watchers bundle signal-exit,
  // which re-raises a signal whenever it finds no other listener left and would
  // terminate this process in the middle of the teardown below.
  process.on('SIGINT', () => { requestShutdown(130, undefined) })
  process.on('SIGTERM', () => { requestShutdown(0, 'SIGTERM') })

  const buildExit = options.skipBuild ? 0 : await runBuild()
  if (shutdownRequested()) process.exit(await shutdown.promise)
  if (buildExit !== 0) {
    console.error(`dev-web: pnpm run build exited (code ${String(buildExit)})`)
    process.exit(1)
  }

  const buildEnvironment = devWebBuildEnvironment(repoRoot, process.env)
  for (const name of Object.keys(process.env)) {
    if (name === CLIENT_BUILD_PROFILE_SELECTOR || name.startsWith('DSH_CLIENT_')) {
      Reflect.deleteProperty(process.env, name)
    }
  }
  for (const [name, value] of Object.entries(buildEnvironment)) {
    if (name.startsWith('DSH_CLIENT_') && value !== undefined) process.env[name] = value
  }

  const pluginDirs = discoverPluginDirs()
  const libraryDirs = discoverLibraryDirs()
  if (pluginDirs.length === 0) {
    console.error('dev-web: no dsh.client (platform "web") packages found under packages/')
    process.exit(1)
  }
  if (libraryDirs.length === 0) {
    console.error('dev-web: no client-preset library packages found under packages/ — the compile shell links their lib products, so an empty set means the discovery predicate is stale')
    process.exit(1)
  }

  // tsc has no polling interval flag, so `--poll` selects its fixed-interval
  // watchers rather than an interval. Dropping that translation leaves tsc
  // natively watching on a network mount where inotify never fires: it stops
  // re-emitting lib/types, and the two later stages then rebuild forever from
  // stale input without printing anything.
  spawnStage(supervisor, `tsc -b ${CLIENT_TYPE_PROGRAM} --watch`, 'tsc', [
    '-b', CLIENT_TYPE_PROGRAM, '--watch', '--preserveWatchOutput',
    ...options.pollInterval !== undefined
      ? ['--watchFile', 'fixedPollingInterval', '--watchDirectory', 'fixedPollingInterval']
      : [],
  ], true)

  // tsdown's initial builds are awaited before the dist watcher starts so vite's
  // first build reads current lib bundles rather than whatever the last full
  // build left. Its own watch then covers later lib rewrites — those files are
  // in its module graph.
  const bundles = await watchClientPlugins(repoRoot, [...pluginDirs, ...libraryDirs], options.pollInterval)
  if (!shutdownRequested()) {
    // Through the shell's own `watch` script rather than vite's API: vite is not a
    // repository-root dependency, and more importantly the vite root is its
    // working directory — `resolve.dedupe` resolves react from that root, so
    // running vite from anywhere but apps/web silently switches which react copy
    // the bundle gets.
    spawnStage(supervisor, 'vite build --watch', 'pnpm', ['--filter', SHELL_PACKAGE, 'run', 'watch'], false)
    // The same launch vector as the root `dsh` script, so the served Host runs
    // from source exactly as `pnpm dsh web` would.
    if (options.serve) {
      spawnStage(supervisor, 'dsh web', process.execPath, [
        '--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', ...options.appArgs,
      ], false)
    }
    console.log(
      `dev-web: watching ${String(pluginDirs.length)} dsh.client plugin packages`
      + ` and ${String(libraryDirs.length)} statically linked library packages`
      + (options.pollInterval !== undefined ? ` (polling ${String(options.pollInterval)}ms)` : '')
      + `, plus tsc -b ${CLIENT_TYPE_PROGRAM} and the ${SHELL_PACKAGE} dist build`
      + (options.serve ? ', serving through dsh web' : '')
      + ':\n  '
      + [...pluginDirs, ...libraryDirs].join('\n  '),
    )
  }

  const exitCode = await shutdown.promise
  await supervisor.stop({ signal: requested.signal, graceMs: STOP_GRACE_MS })
  for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
  process.exit(exitCode)
}
