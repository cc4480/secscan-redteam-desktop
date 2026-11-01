/**
 * Bundled Arsenal census seed guard.
 *
 * `resources/arsenal/arsenal.db` is committed data: one reviewed index built by
 * the runner's `arsenal refresh`, materialized into the tree by
 * `scripts/vendor-arsenal.mjs` and copied by electron-builder to
 * `<install>/resources/arsenal`. The desktop provisions a fresh installation's
 * index from it, verified against the pin in `resources/arsenal-manifest.json`.
 * This spec pins the pieces that must never drift silently:
 *
 *   - the seed entry is pinned (64-hex SHA-256 plus the recorded size and
 *     census counts), because an unpinned database is a supply-chain hole;
 *   - the shipped file is exactly the pinned database — hash, size, and the
 *     census its own `index_meta` declares;
 *   - `--check` (the packaging gate) passes against the shipped seed. The
 *     test never downloads or rebuilds: it only runs the gate.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(desktopRoot, 'resources', 'arsenal-manifest.json')
const vendorScript = join(desktopRoot, 'scripts', 'vendor-arsenal.mjs')
const seedPath = join(desktopRoot, 'resources', 'arsenal', 'arsenal.db')

interface ArsenalSeed {
  readonly id?: string
  readonly file?: string
  readonly destination?: string
  readonly sha256?: string
  readonly sizeBytes?: number
  readonly entries?: number
  readonly collections?: number
  readonly sourceRepo?: string
  readonly sourceCommit?: string
  readonly builtAt?: string
}

interface ArsenalManifest {
  readonly version: number
  readonly seeds: readonly ArsenalSeed[]
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ArsenalManifest
const seed = manifest.seeds[0]
const seedBytes = readFileSync(seedPath)

describe('bundled Arsenal census manifest', () => {
  it('pins the production census build', () => {
    expect(manifest.seeds).toHaveLength(1)
    expect(seed!.id).toBe('arsenal-census')
    expect(seed!.file).toBe('arsenal.db')
    expect(seed!.destination).toBe('arsenal')
    expect(seed!.sha256).toBe('e304c529c0e717cc3fddd27200871e073a6a7f04233872ac3a01f07fcd8439aa')
    expect(seed!.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(seed!.sizeBytes).toBe(569_344)
    expect(seed!.entries).toBe(1039)
    expect(seed!.collections).toBe(82)
    // The census was built by the runner's refresh from its one pinned source
    // repo; the manifest records that build so the seed's origin is auditable.
    expect(seed!.sourceRepo).toBe('https://github.com/hack-with-github/awesome-hacking.git')
    expect(seed!.sourceCommit).toMatch(/^[a-f0-9]{40}$/u)
    expect(seed!.builtAt).toBe('2026-10-31T20:24:56.396Z')
  })

  it('ships exactly the pinned database', () => {
    expect(createHash('sha256').update(seedBytes).digest('hex')).toBe(seed!.sha256)
    expect(seedBytes.length).toBe(seed!.sizeBytes)
    const db = new DatabaseSync(seedPath, { readOnly: true })
    try {
      const counts = db.prepare(
        "SELECT (SELECT COUNT(*) FROM entries) AS entries, (SELECT COUNT(*) FROM collections) AS collections",
      ).get() as { entries: number; collections: number }
      expect(counts).toEqual({ entries: 1039, collections: 82 })
    } finally {
      db.close()
    }
  })
})

describe('shipped Arsenal seed', () => {
  it('passes the vendor --check packaging gate', () => {
    const result = spawnSync(process.execPath, [vendorScript, '--check'], { encoding: 'utf8', windowsHide: true })
    expect(result.stderr, 'vendor-arsenal --check stderr').toBe('')
    expect(result.stdout).toContain('ok arsenal-census')
    expect(result.status, 'vendor-arsenal --check exit code').toBe(0)
  })
})
