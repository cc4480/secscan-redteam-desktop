/**
 * Materialize the external-tool payload shipped as `resources/tools`.
 *
 * The binaries are build output, not source: they are gitignored and every copy
 * is reproducible from `resources/tools-manifest.json` (pinned URL + SHA-256).
 * `electron-builder-config.mjs` copies the directory into the installer, and
 * `apps/desktop/src/redteam-runner.ts` points the engagement runner at it with
 * `REDTEAM_TOOLS_DIR`, so a fresh install can run an engagement without the
 * operator installing nmap, ffuf, gobuster or a wordlist.
 *
 * Usage:
 *   node apps/desktop/scripts/vendor-tools.mjs              # every pinned tool + the wordlist
 *   node apps/desktop/scripts/vendor-tools.mjs --tool nmap  # one tool
 *   node apps/desktop/scripts/vendor-tools.mjs --record-hashes
 *   node apps/desktop/scripts/vendor-tools.mjs --check      # packaging gate: nothing downloaded
 *
 * Rules the script enforces:
 *   - a manifest entry with no `url` is skipped with a warning (Tier 2/3 placeholders);
 *   - a download whose SHA-256 does not match the pin is deleted and fails the run;
 *   - `--record-hashes` is the ONLY way an empty pin is filled, and it prints what it recorded;
 *   - `--check` never writes (used by the packaging spec / CI).
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(here, '..')
const manifestPath = join(desktopRoot, 'resources', 'tools-manifest.json')
const targetRoot = join(desktopRoot, 'resources', 'tools')
const cacheRoot = join(desktopRoot, '.tools-cache')

const argv = process.argv.slice(2)
const has = flag => argv.includes(flag)
const valueOf = flag => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}
const checkOnly = has('--check')
const recordHashes = has('--record-hashes')
const onlyTool = valueOf('--tool')
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
  if (!response.ok) throw new Error(`download failed ${String(response.status)} for ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Recursively copy a directory tree. */
async function copyTree(from, to) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const destination = join(to, entry.name)
    if (entry.isDirectory()) await copyTree(source, destination)
    else if (entry.isFile()) await copyFile(source, destination)
  }
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

/** Extract one archive into a fresh temp directory, then vendor the wanted subtree. */
async function vendorTool(tool, manifest) {
  const label = `${tool.id}@${tool.version || 'unversioned'}`
  if (typeof tool.url !== 'string' || tool.url === '') {
    console.warn(`[tools] skip ${label}: no pinned url in the manifest yet (tier ${String(tool.tier ?? '?')})`)
    return { id: tool.id, skipped: true }
  }
  const destination = join(targetRoot, tool.destination ?? tool.id)
  const cacheFile = join(cacheRoot, basename(new URL(tool.url).pathname) || `${tool.id}.zip`)

  if (checkOnly) {
    const installed = existsSync(destination)
    const pinned = typeof tool.sha256 === 'string' && tool.sha256.length === 64
    if (!installed) throw new Error(`[tools] ${label}: not vendored at ${destination}`)
    if (!pinned) throw new Error(`[tools] ${label}: manifest has no pinned sha256`)
    console.log(`[tools] ok ${label} -> ${destination}`)
    return { id: tool.id, ok: true }
  }

  let archive
  if (existsSync(cacheFile) && !force) {
    archive = await readFile(cacheFile)
  } else {
    console.log(`[tools] download ${label} (${tool.url})`)
    archive = await download(tool.url)
    await mkdir(cacheRoot, { recursive: true })
    await writeFile(cacheFile, archive)
  }
  const actual = sha256(archive)
  if (!tool.sha256) {
    if (!recordHashes) {
      throw new Error(`[tools] ${label}: manifest pin is empty. Reviewed hash: ${actual}. Re-run with --record-hashes to record it.`)
    }
    tool.sha256 = actual
    console.log(`[tools] recorded sha256 ${actual} for ${label}`)
  } else if (tool.sha256 !== actual) {
    await rm(cacheFile, { force: true }).catch(() => undefined)
    throw new Error(`[tools] ${label}: sha256 mismatch. pinned=${tool.sha256} actual=${actual}`)
  }

  const scratch = join(cacheRoot, `extract-${tool.id}`)
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
  // bsdtar ships with Windows 10/11 and reads zip; unzip on POSIX.
  const extractor = process.platform === 'win32' ? ['tar', ['-xf', cacheFile, '-C', scratch]] : ['unzip', ['-q', cacheFile, '-d', scratch]]
  await run(extractor[0], extractor[1])

  const stripped = tool.stripDirectory ? join(scratch, tool.stripDirectory) : scratch
  if (!existsSync(stripped)) {
    throw new Error(`[tools] ${label}: stripDirectory "${String(tool.stripDirectory)}" is not in the archive`)
  }
  await rm(destination, { recursive: true, force: true })
  await copyTree(stripped, destination)
  await writeFile(join(destination, '.provenance.json'), `${JSON.stringify({
    id: tool.id,
    version: tool.version,
    url: tool.url,
    sha256: actual,
    license: tool.license,
    note: tool.note,
    vendoredAt: new Date().toISOString(),
  }, null, 2)}\n`)
  const bytes = await treeSize(destination)
  console.log(`[tools] vendored ${label} -> ${destination} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
  return { id: tool.id, bytes }
}

/** Copy the bundled wordlist out of the vendored runner payload, so discovery has one. */
async function vendorWordlist(manifest) {
  const spec = manifest.wordlist
  if (spec === undefined) return { skipped: true }
  const source = join(desktopRoot, 'resources', ...spec.source.split('/'))
  const destination = join(targetRoot, ...spec.destination.split('/'))
  if (checkOnly) {
    if (!existsSync(destination)) throw new Error(`[tools] wordlist not vendored at ${destination}`)
    console.log(`[tools] ok wordlist -> ${destination}`)
    return { ok: true }
  }
  if (!existsSync(source)) {
    console.warn(`[tools] wordlist source missing (${source}); run scripts/vendor-redteam-runner.mjs first`)
    return { skipped: true }
  }
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
  console.log(`[tools] vendored wordlist -> ${destination}`)
  return { ok: true }
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const tools = onlyTool === undefined ? manifest.tools : manifest.tools.filter(tool => tool.id === onlyTool)
  if (tools.length === 0) throw new Error(`[tools] no manifest entry for --tool ${String(onlyTool)}`)
  await mkdir(targetRoot, { recursive: true })
  const results = []
  for (const tool of tools) results.push(await vendorTool(tool, manifest))
  if (onlyTool === undefined) results.push(await vendorWordlist(manifest))
  if (recordHashes) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log('[tools] manifest updated with recorded hashes')
  }
  const failed = results.filter(result => result !== undefined && result.ok === false)
  if (failed.length > 0) throw new Error(`[tools] ${String(failed.length)} tool(s) failed`)
  console.log(`[tools] done: ${String(results.filter(result => result.bytes !== undefined).length)} vendored`)
}

await main()
