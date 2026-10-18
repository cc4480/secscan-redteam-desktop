/**
 * Materialize the bundled llama.cpp runtime shipped as `resources/llama`.
 *
 * `llama-server.exe` is build output, not source: it is gitignored and every copy
 * is reproducible from `resources/llama-manifest.json` (pinned URL + SHA-256).
 * `scripts/electron-builder-config.mjs` copies the directory into the installer as
 * `resources/llama`, and the local-model supervisor in `apps/desktop/src/` starts
 * that executable, so a fresh install can serve a local GGUF model without the
 * operator installing llama.cpp.
 *
 * Usage:
 *   node apps/desktop/scripts/vendor-llama.mjs                  # every pinned release
 *   node apps/desktop/scripts/vendor-llama.mjs --release llama  # one release
 *   node apps/desktop/scripts/vendor-llama.mjs --record-hashes
 *   node apps/desktop/scripts/vendor-llama.mjs --check          # packaging gate: nothing downloaded
 *
 * Rules the script enforces:
 *   - the archive is pruned to the manifest `keep` list; every keep pattern must
 *     match at least one archived file, and `llama-server.exe` must survive;
 *   - a download whose SHA-256 does not match the pin is deleted and fails the run;
 *   - `--record-hashes` is the ONLY way an empty pin is filled, and it prints what it recorded;
 *   - `--check` never writes (used by the packaging spec / CI): it verifies the pin,
 *     the vendored payload and that the payload holds nothing outside the keep list.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(here, '..')
const manifestPath = join(desktopRoot, 'resources', 'llama-manifest.json')
// A release `destination` is relative to `resources/`: destination "llama" means the
// payload lands at `resources/llama/llama-server.exe`, exactly where the supervisor
// and the electron-builder `extraResources` mapping expect it.
const targetRoot = join(desktopRoot, 'resources')
const cacheRoot = join(desktopRoot, '.llama-cache')
const provenanceName = '.provenance.json'

const argv = process.argv.slice(2)
const has = flag => argv.includes(flag)
const valueOf = flag => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}
const checkOnly = has('--check')
const recordHashes = has('--record-hashes')
const onlyRelease = valueOf('--release')
const force = has('--force')

/** @returns SHA-256 of a buffer, lowercase hex. */
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Run a child process and fail the script on a non-zero exit. */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${String(code)}: ${stderr.slice(-500)}`))
    })
  })
}

/** Download to a buffer, following redirects (GitHub release assets redirect). */
async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`[llama] download failed ${String(response.status)} for ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Total bytes under a directory, for the build log. */
async function treeSize(directory) {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) total += await treeSize(path)
    else if (entry.isFile()) total += (await stat(path)).size
  }
  return total
}

/** Every file under a directory, as posix-style relative paths. */
async function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(absolute, relativePath))
    else if (entry.isFile()) files.push(relativePath)
  }
  return files
}

/** Compile one keep pattern (exact name, or `*` matching any run of characters). */
function keepMatcher(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*')
  return new RegExp(`^${escaped}$`, 'u')
}

/** Split a manifest keep list into compiled matchers, rejecting an entry-less list. */
function keepMatchers(release, label) {
  const keep = Array.isArray(release.keep)
    ? release.keep.filter(pattern => typeof pattern === 'string' && pattern !== '')
    : []
  if (keep.length === 0) throw new Error(`[llama] ${label}: manifest has no keep list`)
  if (!keep.includes('llama-server.exe')) {
    throw new Error(`[llama] ${label}: the keep list must name llama-server.exe`)
  }
  return keep.map(pattern => ({ pattern, matcher: keepMatcher(pattern) }))
}

/** A relative path is kept when a pattern matches the path or its basename. */
function matchesKeep(relativePath, matchers) {
  return matchers.some(({ matcher }) => matcher.test(relativePath) || matcher.test(basename(relativePath)))
}

/** Verify a materialized payload against the manifest without writing anything. */
async function checkRelease(release, label, destination, matchers) {
  if (typeof release.url !== 'string' || release.url === '') {
    throw new Error(`[llama] ${label}: manifest has no pinned url`)
  }
  if (typeof release.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(release.sha256)) {
    throw new Error(`[llama] ${label}: manifest has no pinned sha256`)
  }
  if (typeof release.license !== 'string' || release.license === '') {
    throw new Error(`[llama] ${label}: manifest has no license`)
  }
  if (release.archive !== 'zip') throw new Error(`[llama] ${label}: unsupported archive "${String(release.archive)}"`)
  if (!existsSync(destination)) {
    throw new Error(`[llama] ${label}: not vendored at ${destination}; run node apps/desktop/scripts/vendor-llama.mjs`)
  }
  const files = (await listFiles(destination)).filter(name => name !== provenanceName)
  const stray = files.filter(name => !matchesKeep(name, matchers))
  if (stray.length > 0) {
    throw new Error(`[llama] ${label}: payload holds files outside the keep list: ${stray.join(', ')}`)
  }
  for (const entry of matchers) {
    if (!files.some(name => matchesKeep(name, [entry]))) {
      throw new Error(`[llama] ${label}: keep pattern "${entry.pattern}" is not vendored at ${destination}`)
    }
  }
  const provenancePath = join(destination, provenanceName)
  if (existsSync(provenancePath)) {
    const provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
    if (provenance.sha256 !== release.sha256) {
      throw new Error(`[llama] ${label}: payload was vendored from sha256 ${String(provenance.sha256)}, manifest pins ${release.sha256}; re-run the script`)
    }
  }
  console.log(`[llama] ok ${label} -> ${destination} (${String(files.length)} files)`)
  return { id: release.id, ok: true }
}

/** Download, verify, extract, prune to the keep list and write one release payload. */
async function vendorRelease(release) {
  const label = `${release.id}@${release.version || 'unversioned'}`
  const matchers = keepMatchers(release, label)
  const destination = join(targetRoot, release.destination ?? release.id)
  if (checkOnly) return checkRelease(release, label, destination, matchers)

  if (typeof release.url !== 'string' || release.url === '') {
    throw new Error(`[llama] ${label}: manifest has no pinned url`)
  }
  if (release.archive !== 'zip') throw new Error(`[llama] ${label}: unsupported archive "${String(release.archive)}"`)
  const cacheFile = join(cacheRoot, basename(new URL(release.url).pathname) || `${release.id}.zip`)

  let archive
  if (existsSync(cacheFile) && !force) {
    archive = await readFile(cacheFile)
  } else {
    console.log(`[llama] download ${label} (${release.url})`)
    archive = await download(release.url)
    await mkdir(cacheRoot, { recursive: true })
    await writeFile(cacheFile, archive)
  }
  const actual = sha256(archive)
  if (!release.sha256) {
    if (!recordHashes) {
      throw new Error(`[llama] ${label}: manifest pin is empty. Reviewed hash: ${actual}. Re-run with --record-hashes to record it.`)
    }
    release.sha256 = actual
    console.log(`[llama] recorded sha256 ${actual} for ${label}`)
  } else if (release.sha256 !== actual) {
    await rm(cacheFile, { force: true }).catch(() => undefined)
    throw new Error(`[llama] ${label}: sha256 mismatch. pinned=${release.sha256} actual=${actual}`)
  }

  const scratch = join(cacheRoot, `extract-${release.id}`)
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
  // bsdtar ships with Windows 10/11 and reads zip; unzip on POSIX.
  const extractor = process.platform === 'win32' ? ['tar', ['-xf', cacheFile, '-C', scratch]] : ['unzip', ['-q', cacheFile, '-d', scratch]]
  await run(extractor[0], extractor[1])

  const stripped = typeof release.stripDirectory === 'string' && release.stripDirectory !== ''
    ? join(scratch, release.stripDirectory)
    : scratch
  if (!existsSync(stripped)) {
    throw new Error(`[llama] ${label}: stripDirectory "${String(release.stripDirectory)}" is not in the archive`)
  }
  const available = await listFiles(stripped)
  for (const entry of matchers) {
    if (!available.some(name => matchesKeep(name, [entry]))) {
      throw new Error(`[llama] ${label}: keep pattern "${entry.pattern}" matched nothing in the archive`)
    }
  }
  const selected = available.filter(name => matchesKeep(name, matchers))
  if (!selected.some(name => basename(name) === 'llama-server.exe')) {
    throw new Error(`[llama] ${label}: llama-server.exe is not in the archive`)
  }

  await rm(destination, { recursive: true, force: true })
  for (const relativePath of selected) {
    const target = join(destination, ...relativePath.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(stripped, ...relativePath.split('/')), target)
  }
  await writeFile(join(destination, provenanceName), `${JSON.stringify({
    id: release.id,
    version: release.version,
    url: release.url,
    sha256: actual,
    license: release.license,
    note: release.note,
    keep: release.keep,
    vendoredAt: new Date().toISOString(),
  }, null, 2)}\n`)
  const bytes = await treeSize(destination)
  console.log(`[llama] vendored ${label} -> ${destination} (${String(selected.length)} files, ${(bytes / 1024 / 1024).toFixed(1)} MB)`)
  return { id: release.id, bytes, files: selected.length }
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const releases = Array.isArray(manifest.releases) ? manifest.releases : []
  if (releases.length === 0) throw new Error('[llama] manifest has no releases')
  const selected = onlyRelease === undefined ? releases : releases.filter(release => release.id === onlyRelease)
  if (selected.length === 0) throw new Error(`[llama] no manifest entry for --release ${String(onlyRelease)}`)
  if (!checkOnly) await mkdir(targetRoot, { recursive: true })
  const results = []
  for (const release of selected) results.push(await vendorRelease(release))
  if (recordHashes && !checkOnly) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log('[llama] manifest updated with recorded hashes')
  }
  const failed = results.filter(result => result !== undefined && result.ok === false)
  if (failed.length > 0) throw new Error(`[llama] ${String(failed.length)} release(s) failed`)
  console.log(`[llama] done: ${String(results.filter(result => result.bytes !== undefined).length)} vendored`)
}

await main()
