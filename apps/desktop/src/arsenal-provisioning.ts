/**
 * First-run provisioning of the bundled Arsenal index.
 *
 * The runner serves its Arsenal census from `<userData>/arsenal/arsenal.db`
 * (the engagements-dir derivation in the runner's `resolveArsenalConfig`), and
 * its own refresh timer first ticks a week after launch — so without this step
 * a fresh install has no index at all and the Arsenal page can only report the
 * empty-index state. The desktop ships one reviewed census build as the seed
 * (`resources/arsenal/arsenal.db`, pinned by `resources/arsenal-manifest.json`)
 * and this module materializes it exactly once:
 *
 *   - an index already at the canonical path is the installation's own data
 *     (a refresh may have rebuilt it since) and is never overwritten;
 *   - the seed is hashed before the copy and the copy is hashed again before
 *     it is renamed into place; a seed that does not match the manifest pin
 *     provisions nothing;
 *   - the copy lands through a same-directory temporary file plus rename, so
 *     an interrupted run leaves the old state or the whole seed, never a
 *     half-written database;
 *   - every failure — no bundled seed in a source checkout, an unreadable or
 *     malformed manifest, a hash mismatch, a filesystem error — resolves to
 *     the `unavailable` outcome with the reason logged. Provisioning never
 *     throws: a missing optional index must not fail the launch, and the page
 *     keeps reporting its honest empty state until a refresh builds one.
 */

import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Directory the packaged seed occupies beside the bundled runtime. */
export const ARSENAL_RESOURCE_DIRECTORY = 'arsenal'

/** Seed file inside that directory; also the file name the runner serves. */
export const ARSENAL_SEED_FILE = 'arsenal.db'

/** Manifest at the resources root pinning the seed's SHA-256. */
export const ARSENAL_MANIFEST_FILE = 'arsenal-manifest.json'

/** How one installation resolves its bundled payload on a launch. */
export interface ArsenalSeedLocation {
  /** Whether this launch is the packaged application, which fixes where its resources are. */
  readonly packaged: boolean
  /** `process.resourcesPath` of this application. */
  readonly resourcesPath: string
  /** `app.getAppPath()`; an unpackaged launch reaches the payload through this directory. */
  readonly appPath: string
}

/** The bundled seed and its pin, resolved for one launch. */
export interface ArsenalSeedPaths {
  /** Absolute path of the bundled seed database. */
  readonly seedPath: string
  /** Absolute path of the manifest pinning the seed. */
  readonly manifestPath: string
}

/** What one provisioning attempt did; every outcome is a normal result. */
export type ArsenalProvisioningResult =
  /** An index already lives at the canonical path; it was left byte-untouched. */
  | { readonly status: 'already-present'; readonly dbPath: string }
  /** The seed was verified and materialized at the canonical path. */
  | { readonly status: 'provisioned'; readonly dbPath: string; readonly sha256: string }
  /** Nothing was written; `reason` names why, in operator terms. */
  | { readonly status: 'unavailable'; readonly dbPath: string; readonly reason: string }

/** One seed entry of `resources/arsenal-manifest.json`, as this module consumes it. */
interface ArsenalSeedEntry {
  readonly file?: unknown
  readonly sha256?: unknown
}

/**
 * Resolve the bundled seed for one launch. A packaged install carries it
 * beside the runtime; an unpackaged launch reads it from the checkout.
 * @param location - Where this application's resources are and how it was launched.
 * @returns The seed database path and the manifest that pins it.
 */
export function arsenalSeedPaths(location: ArsenalSeedLocation): ArsenalSeedPaths {
  const resourcesRoot = location.packaged
    ? location.resourcesPath
    : join(location.appPath, 'resources')
  return {
    seedPath: join(resourcesRoot, ARSENAL_RESOURCE_DIRECTORY, ARSENAL_SEED_FILE),
    manifestPath: join(resourcesRoot, ARSENAL_MANIFEST_FILE),
  }
}

/**
 * The canonical index path the runner serves for one installation.
 * @param userDataDir - The application's per-user data directory (`app.getPath('userData')`).
 * @returns `<userDataDir>/arsenal/arsenal.db`.
 */
export function arsenalIndexPath(userDataDir: string): string {
  return join(userDataDir, ARSENAL_RESOURCE_DIRECTORY, ARSENAL_SEED_FILE)
}

/**
 * SHA-256 of one file, lowercase hex.
 * @param path - File to hash.
 * @returns The hex digest.
 */
function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Read the manifest pin for the seed entry naming {@link ARSENAL_SEED_FILE}.
 * @param manifestPath - The bundled manifest to parse.
 * @returns The pinned SHA-256, or the reason no pin could be read.
 */
function readSeedPin(manifestPath: string): { readonly sha256: string } | { readonly reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { reason: `the bundled arsenal manifest is unreadable at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { reason: `the bundled arsenal manifest at ${manifestPath} is not a manifest document` }
  }
  const seeds = (parsed as { seeds?: unknown }).seeds
  if (!Array.isArray(seeds)) return { reason: `the bundled arsenal manifest at ${manifestPath} lists no seeds` }
  const entry = (seeds as ArsenalSeedEntry[]).find(candidate => candidate.file === ARSENAL_SEED_FILE)
  if (entry === undefined) return { reason: `the bundled arsenal manifest at ${manifestPath} pins no ${ARSENAL_SEED_FILE} seed` }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
    return { reason: `the bundled arsenal manifest at ${manifestPath} carries no valid sha256 pin for the seed` }
  }
  return { sha256: entry.sha256 }
}

/**
 * Materialize the bundled Arsenal seed at the canonical index path when the
 * installation has no index yet. Runs once per launch before the engagement
 * runner starts; the common outcome after the first run is `already-present`
 * and costs one existence check.
 * @param options - The installation's userData directory, the launch location
 *   the seed resolves from, and the log sinks outcomes are reported through.
 * @returns The outcome; this function never throws.
 */
export function provisionArsenalIndex(options: {
  readonly userDataDir: string
  readonly location: ArsenalSeedLocation
  readonly log?: (message: string) => void
  readonly logError?: (message: string) => void
}): ArsenalProvisioningResult {
  const log = options.log ?? ((message: string) => { console.info(message) })
  const logError = options.logError ?? ((message: string) => { console.error(message) })
  const dbPath = arsenalIndexPath(options.userDataDir)
  const unavailable = (reason: string): ArsenalProvisioningResult => {
    logError(`[arsenal] no index provisioned: ${reason}; the Arsenal page will report its empty-index state until a refresh builds one`)
    return { status: 'unavailable', dbPath, reason }
  }
  try {
    if (existsSync(dbPath)) return { status: 'already-present', dbPath }
    const { seedPath, manifestPath } = arsenalSeedPaths(options.location)
    if (!existsSync(seedPath)) {
      return unavailable(`no bundled seed at ${seedPath} (a source checkout ships one only after the census is vendored into resources/arsenal)`)
    }
    if (!existsSync(manifestPath)) {
      return unavailable(`no bundled arsenal manifest at ${manifestPath}`)
    }
    const pin = readSeedPin(manifestPath)
    if ('reason' in pin) return unavailable(pin.reason)
    const seedHash = sha256File(seedPath)
    if (seedHash !== pin.sha256) {
      return unavailable(`the bundled seed at ${seedPath} does not match its manifest pin (pinned ${pin.sha256}, actual ${seedHash}); refusing to provision a database that cannot be verified`)
    }
    const directory = join(options.userDataDir, ARSENAL_RESOURCE_DIRECTORY)
    mkdirSync(directory, { recursive: true })
    const temporary = join(directory, `.${ARSENAL_SEED_FILE}.tmp-${String(process.pid)}-${randomBytes(6).toString('hex')}`)
    try {
      copyFileSync(seedPath, temporary)
      const copyHash = sha256File(temporary)
      if (copyHash !== pin.sha256) {
        return unavailable(`the copied seed does not match its manifest pin (pinned ${pin.sha256}, actual ${copyHash}); the copy was discarded`)
      }
      renameSync(temporary, dbPath)
    } finally {
      // After a successful rename the temporary path no longer exists; after a
      // failure it must not linger beside the index as a partial database.
      rmSync(temporary, { force: true })
    }
    const shippedHash = sha256File(dbPath)
    if (shippedHash !== pin.sha256) {
      return unavailable(`the provisioned index at ${dbPath} failed verification after writing (pinned ${pin.sha256}, actual ${shippedHash})`)
    }
    log(`[arsenal] provisioned the bundled census seed at ${dbPath} (sha256 ${pin.sha256})`)
    return { status: 'provisioned', dbPath, sha256: pin.sha256 }
  } catch (error) {
    return unavailable(`provisioning failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
