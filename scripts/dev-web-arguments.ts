/** Resolved `dev-web` command line: the script's own flags plus the arguments forwarded to `dsh web`. */
export interface DevWebArguments {
  /** Skip the complete `pnpm run build` that otherwise precedes the watchers. */
  readonly skipBuild: boolean
  /** Start `dsh web`; false keeps only the rebuild watchers beside an already running server. */
  readonly serve: boolean
  /** Source-watcher polling interval in milliseconds; undefined selects native watching. */
  readonly pollInterval: number | undefined
  /** Arguments forwarded verbatim to `dsh web`, in order. */
  readonly appArgs: readonly string[]
}

/** Polling interval selected by a bare `--poll`. */
const DEFAULT_POLL_INTERVAL = 500

/**
 * Parse the script's command line. `--skip-build`, `--no-serve`, and `--poll[=ms]`
 * belong to this script; a bare `--` is dropped; every other token is forwarded
 * to `dsh web`.
 * @param argv - arguments after the script path.
 * @returns the resolved flags and forwarded arguments.
 * @throws Error when `--poll` carries a non-positive or non-integer interval, or
 * when `--no-serve` leaves forwarded arguments without a `dsh web` process.
 */
export function parseDevWebArguments(argv: readonly string[]): DevWebArguments {
  let skipBuild = false
  let serve = true
  let pollInterval: number | undefined
  const appArgs: string[] = []
  for (const arg of argv) {
    // `pnpm run` forwards a `--` separator verbatim; it carries no meaning here.
    if (arg === '--') continue
    if (arg === '--skip-build') skipBuild = true
    else if (arg === '--no-serve') serve = false
    else if (arg === '--poll' || arg.startsWith('--poll=')) {
      pollInterval = arg === '--poll' ? DEFAULT_POLL_INTERVAL : Number(arg.slice('--poll='.length))
      if (!Number.isInteger(pollInterval) || pollInterval <= 0) throw new Error(`dev-web: invalid --poll interval "${arg}"`)
    } else appArgs.push(arg)
  }
  if (!serve && appArgs.length > 0) {
    throw new Error(`dev-web: --no-serve leaves no dsh web process for ${appArgs[0] ?? ''}`)
  }
  return { skipBuild, serve, pollInterval, appArgs }
}
