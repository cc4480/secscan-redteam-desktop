/**
 * Arsenal configuration (build brief §1.6, spec §11).
 *
 * The runner's `resolveConfig` (phases/config.ts) is engagement-scoped — the
 * console boots without it — so Arsenal resolves its own config from the
 * environment with the same discipline: every field is a validated config
 * field (never a hardcoded constant), empty env values count as unset, and
 * an invalid value throws at resolution naming the exact variable — never
 * default-and-continue.
 */
import { dirname, join, resolve } from 'node:path'

/** Resolved Arsenal configuration; every field validated at load. */
export interface ArsenalConfig {
  /** Tools listed on the console `/mcp` (spec §11). false ⇒ the three tools are absent, not stubs. */
  enabled: boolean
  /** Absolute path of the serving index database (spec §5). */
  dbPath: string
  /** `<data-home>/arsenal` — parent of `dbPath`; the refresh cache lives under it. */
  arsenalDir: string
  /** Refresh clone of the one pinned source repo: `<arsenalDir>/cache/awesome-hacking`. */
  cacheDir: string
  /** The one git remote the refresh may pull (spec §6.4). Changing it is an operator act. */
  sourceRepo: string
  /** Refresh timer interval; weekly by default, 0 = manual refresh only. */
  refreshIntervalHours: number
  /** Ingest bound per collection; overflow is counted in build meta, never silent. */
  maxEntriesPerCollection: number
}

export const DEFAULT_ARSENAL_SOURCE_REPO = 'https://github.com/hack-with-github/awesome-hacking.git'
export const DEFAULT_ARSENAL_REFRESH_INTERVAL_HOURS = 168
export const DEFAULT_ARSENAL_MAX_ENTRIES_PER_COLLECTION = 20000

/** Env value with the codebase convention: unset and blank are the same thing. */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return undefined
  return raw.trim()
}

function parseEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw === '1') return true
  if (raw === '0') return false
  throw new Error(`[arsenal] bad REDTEAM_ARSENAL_ENABLED=${JSON.stringify(raw)}; want 0 or 1`)
}

function parseNonNegativeInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`[arsenal] bad ${name}=${JSON.stringify(raw)}; want an integer >= 0`)
  }
  return n
}

function parsePositiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`[arsenal] bad ${name}=${JSON.stringify(raw)}; want an integer >= 1`)
  }
  return n
}

function parseSourceRepo(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_ARSENAL_SOURCE_REPO
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`[arsenal] bad REDTEAM_ARSENAL_SOURCE_REPO=${JSON.stringify(raw)}; want an https URL`)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error(
      `[arsenal] bad REDTEAM_ARSENAL_SOURCE_REPO=${JSON.stringify(raw)}; want an https URL without credentials`,
    )
  }
  return raw
}

/**
 * Resolve Arsenal configuration.
 *
 * Database path (brief §1.4): `REDTEAM_ARSENAL_DB_PATH` wins; otherwise the
 * path derives from the console's engagements dir
 * (`<engagementsDir>/../../arsenal/arsenal.db`, so the desktop lands at
 * `<userData>/arsenal/arsenal.db`); without an engagements dir it falls
 * back to the console's data-home convention (`REDTEAM_HOME` or cwd).
 * The database never lives under `live/`, a payload dir, or an XDG path.
 */
export function resolveArsenalConfig(
  env: NodeJS.ProcessEnv,
  opts: { engagementsDir?: string } = {},
): ArsenalConfig {
  const override = envValue(env, 'REDTEAM_ARSENAL_DB_PATH')
  let dbPath: string
  if (override !== undefined) {
    dbPath = resolve(override)
  } else if (opts.engagementsDir !== undefined) {
    dbPath = resolve(join(opts.engagementsDir, '..', '..', 'arsenal', 'arsenal.db'))
  } else {
    const home = env['REDTEAM_HOME']
    dbPath = resolve(join(home ? home : process.cwd(), 'arsenal', 'arsenal.db'))
  }
  const arsenalDir = dirname(dbPath)
  return {
    enabled: parseEnabled(envValue(env, 'REDTEAM_ARSENAL_ENABLED')),
    dbPath,
    arsenalDir,
    cacheDir: join(arsenalDir, 'cache', 'awesome-hacking'),
    sourceRepo: parseSourceRepo(envValue(env, 'REDTEAM_ARSENAL_SOURCE_REPO')),
    refreshIntervalHours: parseNonNegativeInt(
      envValue(env, 'REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS'),
      'REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS',
      DEFAULT_ARSENAL_REFRESH_INTERVAL_HOURS,
    ),
    maxEntriesPerCollection: parsePositiveInt(
      envValue(env, 'REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION'),
      'REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION',
      DEFAULT_ARSENAL_MAX_ENTRIES_PER_COLLECTION,
    ),
  }
}
