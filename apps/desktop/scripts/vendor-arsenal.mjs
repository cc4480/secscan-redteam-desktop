/**
 * Materialize the bundled Arsenal census seed shipped as `resources/arsenal`.
 *
 * The seed is committed data, not build output: it is one reviewed index built by
 * the runner's `arsenal refresh` from the pinned source repo, and
 * `resources/arsenal-manifest.json` pins its SHA-256, size and census counts. This
 * script is the only sanctioned way to replace it: it copies a reviewed database
 * into `resources/arsenal/arsenal.db` after verifying it against the pin (or, with
 * `--record-hashes`, records a new pin from the reviewed database and prints what
 * it recorded). `scripts/electron-builder-config.mjs` copies the directory into
 * the installer as `resources/arsenal`, and the desktop copies the seed into
 * `<userData>/arsenal/arsenal.db` on first run, so a fresh install opens the
 * Arsenal page on a real census instead of the empty-index state.
 *
 * Usage:
 *   node apps/desktop/scripts/vendor-arsenal.mjs --source <reviewed.db>   # copy a reviewed build in
 *   node apps/desktop/scripts/vendor-arsenal.mjs --record-hashes --source <reviewed.db>
 *   node apps/desktop/scripts/vendor-arsenal.mjs --check                  # packaging gate: nothing written
 *
 * Rules the script enforces:
 *   - a source whose SHA-256 does not match the pin fails the run and copies
 *     nothing, unless `--record-hashes` is given — the only way a pin changes;
 *   - the copy is written to a temporary file in the destination directory and
 *     renamed over the seed, and the renamed file is hashed again, so an
 *     interrupted run never leaves a half-written seed;
 *   - `--check` never writes (used by the packaging spec / CI): it verifies the
 *     pin, the shipped seed's hash and size, and the census counts the seed's
 *     own index_meta declares.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(here, '..')
const manifestPath = join(desktopRoot, 'resources', 'arsenal-manifest.json')
// A seed `destination` is relative to `resources/`: destination "arsenal" means
// the seed lands at `resources/arsenal/arsenal.db`, exactly where the desktop
// provisioning module and the electron-builder `extraResources` mapping expect it.
const targetRoot = join(desktopRoot, 'resources')
const provenanceName = '.provenance.json'

const argv = process.argv.slice(2)
const has = flag => argv.includes(flag)
const valueOf = flag => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}
const checkOnly = has('--check')
const recordHashes = has('--record-hashes')
const onlySeed = valueOf('--seed')
const sourcePath = valueOf('--source')

/** @returns SHA-256 of a buffer, lowercase hex. */
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Read the census a built index declares about itself.
 * @param path - Database file to open read-only.
 * @returns Entry and collection counts from the database's `index_meta`.
 */
function censusOf(path) {
  let db
  try {
    db = new DatabaseSync(path, { readOnly: true })
    const meta = new Map(
      db.prepare('SELECT key, value FROM index_meta').all().map(row => [row.key, row.value]),
    )
    const entries = Number(meta.get('entry_count'))
    const collections = Number(meta.get('collection_count'))
    if (!Number.isInteger(entries) || !Number.isInteger(collections)) {
      throw new Error(`[arsenal] ${path}: index_meta carries no integer entry_count/collection_count`)
    }
    return { entries, collections, builtAt: meta.get('built_at'), sourceCommit: meta.get('source_commit') }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[arsenal]')) throw error
    throw new Error(`[arsenal] ${path}: not a built arsenal index (${error instanceof Error ? error.message : String(error)})`)
  } finally {
    db?.close()
  }
}

/** Reject a manifest entry that cannot pin anything. */
function validatePin(seed, label) {
  if (typeof seed.file !== 'string' || seed.file === '') {
    throw new Error(`[arsenal] ${label}: manifest has no seed file`)
  }
  if (typeof seed.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(seed.sha256)) {
    throw new Error(`[arsenal] ${label}: manifest has no pinned sha256`)
  }
  if (!Number.isInteger(seed.sizeBytes) || seed.sizeBytes < 1) {
    throw new Error(`[arsenal] ${label}: manifest has no pinned sizeBytes`)
  }
  if (!Number.isInteger(seed.entries) || !Number.isInteger(seed.collections)) {
    throw new Error(`[arsenal] ${label}: manifest records no census counts`)
  }
}

/** Verify the shipped seed against the manifest without writing anything. */
async function checkSeed(seed, label, destination) {
  validatePin(seed, label)
  if (!existsSync(destination)) {
    throw new Error(`[arsenal] ${label}: not shipped at ${destination}; run node apps/desktop/scripts/vendor-arsenal.mjs --source <reviewed.db>`)
  }
  const bytes = await readFile(destination)
  const actual = sha256(bytes)
  if (actual !== seed.sha256) {
    throw new Error(`[arsenal] ${label}: shipped seed sha256 mismatch. pinned=${seed.sha256} actual=${actual}`)
  }
  if (bytes.length !== seed.sizeBytes) {
    throw new Error(`[arsenal] ${label}: shipped seed size mismatch. pinned=${String(seed.sizeBytes)} actual=${String(bytes.length)}`)
  }
  const census = censusOf(destination)
  if (census.entries !== seed.entries || census.collections !== seed.collections) {
    throw new Error(
      `[arsenal] ${label}: census drift. manifest records ${String(seed.entries)} entries / ${String(seed.collections)} collections, ` +
      `the seed declares ${String(census.entries)} / ${String(census.collections)}`,
    )
  }
  console.log(`[arsenal] ok ${label} -> ${destination} (${String(bytes.length)} bytes, ${String(census.entries)} entries, ${String(census.collections)} collections)`)
  return { id: seed.id, ok: true }
}

/** Verify a reviewed source database, copy it over the seed, and re-verify the copy. */
async function vendorSeed(seed) {
  const label = String(seed.id ?? 'arsenal-seed')
  const destinationDirectory = join(targetRoot, seed.destination ?? 'arsenal')
  const destination = join(destinationDirectory, seed.file ?? 'arsenal.db')
  if (checkOnly) return checkSeed(seed, label, destination)

  if (sourcePath === undefined) {
    throw new Error('[arsenal] no source database: pass --source <reviewed.db> (a built index you have reviewed)')
  }
  if (!existsSync(sourcePath)) throw new Error(`[arsenal] source database not found: ${sourcePath}`)
  const source = await readFile(sourcePath)
  const actual = sha256(source)
  if (recordHashes) {
    const census = censusOf(sourcePath)
    seed.sha256 = actual
    seed.sizeBytes = source.length
    seed.entries = census.entries
    seed.collections = census.collections
    if (census.builtAt !== undefined) seed.builtAt = census.builtAt
    if (census.sourceCommit !== undefined) seed.sourceCommit = census.sourceCommit
    console.log(`[arsenal] recorded sha256 ${actual} for ${label} (${String(source.length)} bytes, ${String(census.entries)} entries, ${String(census.collections)} collections)`)
  } else {
    validatePin(seed, label)
    if (seed.sha256 !== actual) {
      throw new Error(`[arsenal] ${label}: source sha256 mismatch. pinned=${seed.sha256} actual=${actual}. Re-run with --record-hashes to record the reviewed build.`)
    }
    if (seed.sizeBytes !== source.length) {
      throw new Error(`[arsenal] ${label}: source size mismatch. pinned=${String(seed.sizeBytes)} actual=${String(source.length)}`)
    }
    const census = censusOf(sourcePath)
    if (seed.entries !== census.entries || seed.collections !== census.collections) {
      throw new Error(`[arsenal] ${label}: source census differs from the manifest. recorded=${String(seed.entries)}/${String(seed.collections)} source=${String(census.entries)}/${String(census.collections)}`)
    }
  }

  // Write beside the destination and rename over it: the rename is atomic on the
  // same volume, so a crash leaves the old seed or the new one, never a partial file.
  const temporary = join(destinationDirectory, `.${seed.file ?? 'arsenal.db'}.tmp-${String(process.pid)}`)
  await mkdir(destinationDirectory, { recursive: true })
  await copyFile(sourcePath, temporary)
  const copied = sha256(await readFile(temporary))
  if (copied !== actual) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw new Error(`[arsenal] ${label}: copied seed sha256 mismatch. source=${actual} copy=${copied}`)
  }
  await rename(temporary, destination)
  const shipped = sha256(await readFile(destination))
  if (shipped !== seed.sha256) {
    throw new Error(`[arsenal] ${label}: shipped seed sha256 mismatch after rename. pinned=${seed.sha256} actual=${shipped}`)
  }
  await writeFile(join(destinationDirectory, provenanceName), `${JSON.stringify({
    id: seed.id,
    sha256: seed.sha256,
    sizeBytes: seed.sizeBytes,
    entries: seed.entries,
    collections: seed.collections,
    sourceRepo: seed.sourceRepo,
    sourceCommit: seed.sourceCommit,
    builtAt: seed.builtAt,
    vendoredAt: new Date().toISOString(),
  }, null, 2)}\n`)
  console.log(`[arsenal] vendored ${label} -> ${destination} (${String(seed.sizeBytes)} bytes)`)
  return { id: seed.id, bytes: seed.sizeBytes }
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const seeds = Array.isArray(manifest.seeds) ? manifest.seeds : []
  if (seeds.length === 0) throw new Error('[arsenal] manifest has no seeds')
  const selected = onlySeed === undefined ? seeds : seeds.filter(seed => seed.id === onlySeed)
  if (selected.length === 0) throw new Error(`[arsenal] no manifest entry for --seed ${String(onlySeed)}`)
  const results = []
  for (const seed of selected) results.push(await vendorSeed(seed))
  if (recordHashes && !checkOnly) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log('[arsenal] manifest updated with recorded hashes')
  }
  console.log(`[arsenal] done: ${String(results.filter(result => result.bytes !== undefined).length)} vendored`)
}

await main()
