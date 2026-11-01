/**
 * First-run Arsenal provisioning guard.
 *
 * The desktop ships one reviewed census build as the Arsenal seed
 * (`resources/arsenal/arsenal.db`, pinned by `resources/arsenal-manifest.json`)
 * and `provisionArsenalIndex` copies it to `<userData>/arsenal/arsenal.db`
 * before the engagement runner starts, so a fresh install serves the census
 * instead of the empty-index state. These specs pin the contract the runner's
 * serving layer relies on:
 *
 *   - a fresh profile is provisioned with the seed byte-for-byte, verified
 *     against the manifest pin before and after the copy;
 *   - an index the installation already has is never overwritten;
 *   - a corrupt, mismatched or missing seed provisions nothing and says why —
 *     a bad database is never served.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  arsenalIndexPath,
  arsenalSeedPaths,
  provisionArsenalIndex,
  type ArsenalSeedLocation,
} from '../src/arsenal-provisioning.ts'

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const shippedSeedPath = join(desktopRoot, 'resources', 'arsenal', 'arsenal.db')
const shippedManifestPath = join(desktopRoot, 'resources', 'arsenal-manifest.json')
const shippedSeed = readFileSync(shippedSeedPath)
const shippedPin = createHash('sha256').update(shippedSeed).digest('hex')

const cleanups: string[] = []

function tempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `arsenal-provisioning-${label}-`))
  cleanups.push(root)
  return root
}

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

/** A launch location reading its payload from a checkout rooted at `appPath`. */
function sourceLocation(appPath: string): ArsenalSeedLocation {
  return { packaged: false, resourcesPath: join(appPath, 'packaged-resources'), appPath }
}

/** Log sinks that record instead of printing. */
function capturedLog() {
  const lines: string[] = []
  const errors: string[] = []
  return {
    lines,
    errors,
    log: (message: string) => { lines.push(message) },
    logError: (message: string) => { errors.push(message) },
  }
}

/**
 * A fake checkout carrying the given seed bytes (or none) and manifest text
 * (or none) in the layout a source launch resolves.
 */
function fakeCheckout(seed: Buffer | null, manifest: string | null): string {
  const appPath = tempRoot('checkout')
  const resources = join(appPath, 'resources')
  mkdirSync(join(resources, 'arsenal'), { recursive: true })
  if (seed !== null) writeFileSync(join(resources, 'arsenal', 'arsenal.db'), seed)
  if (manifest !== null) writeFileSync(join(resources, 'arsenal-manifest.json'), manifest)
  return appPath
}

function manifestWithPin(sha256: string): string {
  return `${JSON.stringify({ version: 1, seeds: [{ id: 'arsenal-census', file: 'arsenal.db', sha256 }] }, null, 2)}\n`
}

describe('arsenal seed resolution', () => {
  it('resolves the seed beside the runtime for a packaged launch', () => {
    const paths = arsenalSeedPaths({ packaged: true, resourcesPath: join('C:', 'App', 'resources'), appPath: join('C:', 'checkout') })
    expect(paths.seedPath).toBe(join('C:', 'App', 'resources', 'arsenal', 'arsenal.db'))
    expect(paths.manifestPath).toBe(join('C:', 'App', 'resources', 'arsenal-manifest.json'))
  })

  it('resolves the seed from the checkout for a source launch', () => {
    const paths = arsenalSeedPaths(sourceLocation(join('C:', 'checkout')))
    expect(paths.seedPath).toBe(join('C:', 'checkout', 'resources', 'arsenal', 'arsenal.db'))
    expect(paths.manifestPath).toBe(join('C:', 'checkout', 'resources', 'arsenal-manifest.json'))
  })

  it('derives the canonical index path the runner serves', () => {
    expect(arsenalIndexPath(join('U', 'userData'))).toBe(join('U', 'userData', 'arsenal', 'arsenal.db'))
  })
})

describe('provisionArsenalIndex', () => {
  it('provisions a fresh profile with the shipped seed, byte-for-byte', () => {
    const userDataDir = tempRoot('user-data')
    const sink = capturedLog()
    const result = provisionArsenalIndex({
      userDataDir,
      location: sourceLocation(desktopRoot),
      log: sink.log,
      logError: sink.logError,
    })
    expect(result.status).toBe('provisioned')
    if (result.status !== 'provisioned') throw new Error('expected a provisioned result')
    expect(result.dbPath).toBe(join(userDataDir, 'arsenal', 'arsenal.db'))
    expect(result.sha256).toBe(shippedPin)
    const materialized = readFileSync(result.dbPath)
    expect(materialized.equals(shippedSeed)).toBe(true)
    // The materialized file is the census itself, not just the right bytes:
    // its own index_meta declares the recorded build.
    const db = new DatabaseSync(result.dbPath, { readOnly: true })
    try {
      const counts = db.prepare(
        "SELECT (SELECT value FROM index_meta WHERE key = 'entry_count') AS entries, (SELECT value FROM index_meta WHERE key = 'collection_count') AS collections",
      ).get() as { entries: string; collections: string }
      expect(counts).toEqual({ entries: '1039', collections: '82' })
    } finally {
      db.close()
    }
    expect(sink.lines).toHaveLength(1)
    expect(sink.lines[0]).toContain('provisioned the bundled census seed')
    expect(sink.errors).toEqual([])
  })

  it('is a no-op on the next launch and leaves the provisioned index untouched', () => {
    const userDataDir = tempRoot('user-data')
    const location = sourceLocation(desktopRoot)
    expect(provisionArsenalIndex({ userDataDir, location }).status).toBe('provisioned')
    const before = readFileSync(arsenalIndexPath(userDataDir))
    expect(provisionArsenalIndex({ userDataDir, location }).status).toBe('already-present')
    expect(readFileSync(arsenalIndexPath(userDataDir)).equals(before)).toBe(true)
  })

  it('never overwrites an index the installation already has', () => {
    const userDataDir = tempRoot('user-data')
    const dbPath = arsenalIndexPath(userDataDir)
    mkdirSync(dirname(dbPath), { recursive: true })
    const existing = Buffer.from('an index a refresh built after install')
    writeFileSync(dbPath, existing)
    const result = provisionArsenalIndex({ userDataDir, location: sourceLocation(desktopRoot) })
    expect(result.status).toBe('already-present')
    expect(readFileSync(dbPath).equals(existing)).toBe(true)
  })

  it('provisions nothing from a corrupt seed and logs why', () => {
    const corrupt = Buffer.from(shippedSeed)
    corrupt[1024] = (corrupt[1024]! + 1) % 256
    const appPath = fakeCheckout(corrupt, readFileSync(shippedManifestPath, 'utf8'))
    const userDataDir = tempRoot('user-data')
    const sink = capturedLog()
    const result = provisionArsenalIndex({
      userDataDir,
      location: sourceLocation(appPath),
      log: sink.log,
      logError: sink.logError,
    })
    expect(result.status).toBe('unavailable')
    if (result.status !== 'unavailable') throw new Error('expected an unavailable result')
    expect(result.reason).toContain('does not match its manifest pin')
    expect(existsSync(arsenalIndexPath(userDataDir))).toBe(false)
    expect(sink.errors).toHaveLength(1)
    expect(sink.errors[0]).toContain('no index provisioned')
  })

  it('provisions nothing when the manifest pin names a different database', () => {
    const otherPin = createHash('sha256').update(Buffer.from('some other database')).digest('hex')
    const appPath = fakeCheckout(shippedSeed, manifestWithPin(otherPin))
    const userDataDir = tempRoot('user-data')
    const result = provisionArsenalIndex({ userDataDir, location: sourceLocation(appPath) })
    expect(result.status).toBe('unavailable')
    expect(existsSync(arsenalIndexPath(userDataDir))).toBe(false)
  })

  it('reports a source checkout with no bundled seed instead of failing', () => {
    const appPath = fakeCheckout(null, manifestWithPin(shippedPin))
    const userDataDir = tempRoot('user-data')
    const sink = capturedLog()
    const result = provisionArsenalIndex({
      userDataDir,
      location: sourceLocation(appPath),
      log: sink.log,
      logError: sink.logError,
    })
    expect(result.status).toBe('unavailable')
    if (result.status !== 'unavailable') throw new Error('expected an unavailable result')
    expect(result.reason).toContain('no bundled seed at')
    expect(existsSync(arsenalIndexPath(userDataDir))).toBe(false)
    expect(sink.errors).toHaveLength(1)
  })

  it('reports a bundled seed with no manifest instead of guessing a pin', () => {
    const appPath = fakeCheckout(shippedSeed, null)
    const userDataDir = tempRoot('user-data')
    const result = provisionArsenalIndex({ userDataDir, location: sourceLocation(appPath) })
    expect(result.status).toBe('unavailable')
    if (result.status !== 'unavailable') throw new Error('expected an unavailable result')
    expect(result.reason).toContain('no bundled arsenal manifest at')
    expect(existsSync(arsenalIndexPath(userDataDir))).toBe(false)
  })

  it('reports a malformed manifest instead of provisioning from it', () => {
    const appPath = fakeCheckout(shippedSeed, '{ not a manifest')
    const userDataDir = tempRoot('user-data')
    const result = provisionArsenalIndex({ userDataDir, location: sourceLocation(appPath) })
    expect(result.status).toBe('unavailable')
    expect(existsSync(arsenalIndexPath(userDataDir))).toBe(false)
  })
})
