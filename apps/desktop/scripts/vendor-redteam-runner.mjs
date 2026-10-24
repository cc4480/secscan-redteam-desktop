/**
 * Vendor the engagement runner into the Desktop application payload.
 *
 * The runner (@secscan/redteam-runner) is a package of THIS repository at
 * `apps/redteam-runner`. Its built `dist/` and dependency closure are
 * materialized here, next to the application that executes it, so a packaged
 * install needs nothing else on the machine. Vendoring rebuilds the runner from
 * source first, so the payload can never carry a stale dist.
 *
 * The output is exactly what `extraResources` ships:
 *
 *   resources/redteam-runner/package.json      the runner's own manifest (Node
 *                                              reads `type: module` and the
 *                                              self-referencing `exports` here)
 *   resources/redteam-runner/dist/**           the built runner, unmodified
 *   resources/redteam-runner/node_modules/**   every production dependency and
 *                                              every transitive dependency, minus
 *                                              test/docs noise (PAYLOAD_EXCLUSIONS)
 *   resources/redteam-runner/provenance.json   what was taken from where, and the
 *                                              pnpm lockfile's sha256
 *
 * Paths inside a package are copied dereferenced: pnpm links `@secscan/*`
 * workspace packages with junctions, and an installer must carry the bytes.
 *
 * Usage (from apps/desktop, or through the repository's package manager):
 *   node scripts/vendor-redteam-runner.mjs [--from <runner directory>]
 * The source directory defaults to `DSH_DESKTOP_REDTEAM_RUNNER_DIR`, then to the
 * in-repo `apps/redteam-runner` package.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

/** Directory, relative to this app, that `extraResources` copies to `resources/redteam-runner`. */
export const REDTEAM_RUNNER_PAYLOAD = join('resources', 'redteam-runner')

/** Package name the vendored payload must declare; anything else is the wrong directory. */
const REDTEAM_RUNNER_PACKAGE = '@secscan/redteam-runner'

/** Dependency sections that carry what a shipped payload must contain. */
const DEPENDENCY_SECTIONS = ['dependencies']

/**
 * Path noise kept out of the node_modules copy.
 *
 * The payload is executed on an operator's machine, so this list may only name
 * files that a Node process never loads at runtime. That is why executable and
 * data extensions are absent on purpose: `.js`, `.cjs`, `.mjs`, `.node`, `.wasm`,
 * `.json`, `.lua`, `.txt`, `.crt` and `.pem` can all be read or required by a
 * dependency, and excluding one of them would break the runner instead of
 * shrinking the installer. What remains is test fixtures (ssh2's `test/` carries
 * private keys the console has no business shipping), repository/CI metadata,
 * documentation/example directories, and the non-code artefacts `.md`, `.map`
 * and `.d.ts`. `dist/cli.js doctor` and the payload test lock this in.
 */
const PAYLOAD_EXCLUSIONS = {
  /** Directory basenames that only ever hold tests, CI configuration or docs. */
  directoryNames: new Set(['.github', '__tests__', 'docs', 'examples', 'spec', 'specs', 'test', 'tests']),
  /** File suffixes that are neither executable code nor runtime data. */
  fileSuffixes: ['.d.ts', '.map', '.md'],
}

/**
 * Decide whether one path inside a dependency is noise the payload can drop.
 * @param relativePath - Path relative to the package directory being copied.
 * @returns Whether the copy skips it (and, for a directory, all of its children).
 */
function isExcludedFromPayload(relativePath) {
  const segments = relativePath.split(/[\\/]/u).filter(segment => segment !== '')
  const name = segments.pop()
  if (name === undefined) return false
  // Every ancestor segment must be a directory, so a match there is a directory
  // match; the final segment may be a directory or a file, and both are checked.
  if (segments.some(segment => PAYLOAD_EXCLUSIONS.directoryNames.has(segment.toLowerCase()))) return true
  const lower = name.toLowerCase()
  if (PAYLOAD_EXCLUSIONS.directoryNames.has(lower)) return true
  return PAYLOAD_EXCLUSIONS.fileSuffixes.some(suffix => lower.endsWith(suffix))
}

/** Read a JSON file. */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Resolve a package directory the way Node does, walking up from `from`.
 * @param {string} name - Package name, possibly scoped.
 * @param {string} from - Directory to resolve from.
 * @returns {string | undefined} Absolute package directory, when it is installed.
 */
function packageDirectory(name, from) {
  let directory = from
  const segments = name.split('/')
  for (;;) {
    const candidate = join(directory, 'node_modules', ...segments)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    // pnpm hoists transitive dependencies into the hidden store
    // `node_modules/.pnpm/node_modules/<name>`, which a plain walk-up never sees.
    const hidden = join(directory, 'node_modules', '.pnpm', 'node_modules', ...segments)
    if (existsSync(join(hidden, 'package.json'))) return hidden
    const parent = resolve(directory, '..')
    if (parent === directory) return undefined
    directory = parent
  }
}

/**
 * Parse the command line.
 * @param {readonly string[]} argv - Arguments after the script entry point.
 * @returns {{ from: string }} The runner checkout to read.
 */
function parseArguments(argv) {
  const index = argv.indexOf('--from')
  if (index !== -1) {
    const value = argv[index + 1]
    if (value === undefined || value === '') throw new Error('vendor-redteam-runner: --from requires a directory')
    return { from: resolve(value) }
  }
  const configured = process.env.DSH_DESKTOP_REDTEAM_RUNNER_DIR
  if (configured !== undefined && configured !== '') return { from: resolve(configured) }
  // The runner is a first-class package of this repository (apps/redteam-runner);
  // there is no external checkout to vendor from.
  return { from: join(REPOSITORY_ROOT, 'apps', 'redteam-runner') }
}

/**
 * Collect the production dependency closure of the runner.
 * @param {string} runnerDirectory - The runner checkout.
 * @param {Record<string, unknown>} manifest - The runner's parsed manifest.
 * @param {string[]} problems - Receives unresolvable dependencies.
 * @returns {{ name: string, version: string, directory: string }[]} Sorted closure, self excluded.
 */
function dependencyClosure(runnerDirectory, manifest, problems) {
  const roots = [
    ...Object.keys(manifest.dependencies ?? {}),
  ]
  const resolved = new Map()
  // Each queued entry remembers the directory of the package that declares it, so
  // pnpm's nested `node_modules/<parent>/node_modules/<dep>` layout resolves even
  // though the transitive dep is not hoisted to the repository root.
  const queue = roots.map(name => ({ name, from: runnerDirectory }))
  while (queue.length > 0) {
    const entry = queue.shift()
    if (entry === undefined || resolved.has(entry.name)) continue
    const directory = packageDirectory(entry.name, entry.from)
    if (directory === undefined) {
      problems.push(`${entry.name} is not installed in the source tree`)
      continue
    }
    const packageManifest = readJson(join(directory, 'package.json'))
    resolved.set(entry.name, { name: entry.name, version: packageManifest.version, directory })
    // Optional dependencies are contractually absent-safe, and the only one the
    // source tree installs is ssh2's `nan` build header; it is not shipped.
    for (const depName of Object.keys(packageManifest.dependencies ?? {})) {
      queue.push({ name: depName, from: directory })
    }
  }
  return [...resolved.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * Copy one directory with links resolved, so an installer carries the bytes.
 *
 * Only test/docs noise is filtered (see {@link PAYLOAD_EXCLUSIONS}); everything
 * that could be loaded at runtime is copied byte for byte.
 * @param {string} from - Source directory.
 * @param {string} to - Destination directory.
 */
function copyDereferenced(from, to) {
  mkdirSync(to, { recursive: true })
  const source = realpathSync(from)
  const target = realpathSync(to)
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (path) => {
      const relativePath = relative(source, path)
      return relativePath === '' || !isExcludedFromPayload(relativePath)
    },
  })
}

/**
 * Locate and read the pnpm lockfile of the workspace that installs the closure.
 *
 * The runner is a workspace member: its production dependencies are hoisted to
 * the repository root, so the lockfile pinning the exact versions in
 * `node_modules` is the repository's `pnpm-lock.yaml`. Recording its digest lets
 * a packaged install be matched against the source tree without shipping it.
 * @param {string} source - The runner package directory.
 * @returns {{ path: string, bytes: Buffer, sha256: string }} The lockfile and its digest.
 */
function readWorkspaceLockfile(source) {
  let directory = source
  for (;;) {
    const candidate = join(directory, 'pnpm-lock.yaml')
    if (existsSync(candidate)) {
      const bytes = readFileSync(candidate)
      return { path: candidate, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
    }
    const parent = resolve(directory, '..')
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`vendor-redteam-runner: ${source} is not inside a pnpm workspace: no pnpm-lock.yaml in it or any parent.`)
}

/**
 * Build the in-repo runner package from source, exactly as `pnpm --filter
 * @secscan/redteam-runner run build` would: compile to dist/, copy the console
 * dashboard assets and the wordlist, then stamp dist/ and the two @secscan/*
 * workspace deps' lib/ so the runner's freshness guard passes. Vendoring always
 * rebuilds, so the payload can never ship a stale dist.
 * @param {string} source - The runner package directory.
 */
function buildRunnerFromSource(source) {
  const node = process.execPath
  const tsc = join(REPOSITORY_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  const script = (file, ...args) => execFileSync(node, [file, ...args], { cwd: source, stdio: 'inherit' })
  script(tsc, '-p', 'tsconfig.json')
  script(join(source, 'scripts', 'copy-dir.mjs'), 'src/ui/public', 'dist/ui/public')
  script(join(source, 'scripts', 'copy-dir.mjs'), 'assets', 'dist/assets')
  script(join(source, 'scripts', 'dist-hash.mjs'), 'write', '.')
  script(join(source, 'scripts', 'stamp-deps.mjs'))
}

/**
 * Vendor the runner payload and report what was copied.
 * @param {{ from: string, to?: string }} options - Runner checkout and payload destination.
 * @returns {{ version: string, packages: { name: string, version: string }[] }} What was written.
 */
export /**
 * Remove the `src/` trees of vendored `@secscan/*` packages.
 *
 * Those packages ship a dist-freshness guard (`@secscan/redteam-llm-router`)
 * that hashes `src/` against `lib/.src-hash` and refuses to run when they
 * differ. The vendor copy filters some source files out (README.md), so the
 * copied tree never matches the stamp and every engagement would throw
 * "STALE BUILD" inside a user's install. With `src/` absent the guard skips
 * (it only applies to a source checkout), which is exactly what a shipped
 * payload is.
 * @param destination - the vendored payload root.
 */
function stripVendoredSources(destination) {
  const scope = join(destination, 'node_modules', '@secscan')
  if (!existsSync(scope)) return
  for (const entry of readdirSync(scope, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    rmSync(join(scope, entry.name, 'src'), { recursive: true, force: true })
  }
}

function vendorRedteamRunner(options) {
  const source = options.from
  const destination = options.to ?? join(APP_ROOT, REDTEAM_RUNNER_PAYLOAD)
  const manifest = readJson(join(source, 'package.json'))
  if (manifest.name !== REDTEAM_RUNNER_PACKAGE) {
    throw new Error(`vendor-redteam-runner: ${source} declares ${String(manifest.name)}, expected ${REDTEAM_RUNNER_PACKAGE}`)
  }
  buildRunnerFromSource(source)
  for (const path of ['dist', 'dist/cli.js']) {
    if (!existsSync(join(source, ...path.split('/')))) {
      throw new Error(`vendor-redteam-runner: ${source} has no ${path}; build the runner before vendoring it`)
    }
  }
  const problems = []
  const closure = dependencyClosure(source, manifest, problems)
  if (problems.length > 0) {
    throw new Error(`vendor-redteam-runner: incomplete dependency closure:\n  ${problems.join('\n  ')}`)
  }
  // Every package's own dependencies have to be in the closure too; a
  // transitive edge the walker missed would surface as a missing module only on
  // the operator's machine, at the moment the tool is called.
  const shipped = new Set(closure.map(entry => entry.name))
  for (const entry of closure) {
    const packageManifest = readJson(join(entry.directory, 'package.json'))
    for (const name of Object.keys(packageManifest.dependencies ?? {})) {
      if (!shipped.has(name)) problems.push(`${name} (required by ${entry.name}) is missing from the closure`)
    }
  }
  if (problems.length > 0) {
    throw new Error(`vendor-redteam-runner: incomplete dependency closure:\n  ${problems.join('\n  ')}`)
  }

  // Read the lockfile before touching the destination: a missing or corrupt
  // workspace lockfile must fail loudly, not leave a half-vendored payload that
  // silently ships ranges.
  const lockfile = readWorkspaceLockfile(source)

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  cpSync(join(source, 'package.json'), join(destination, 'package.json'))
  cpSync(join(source, 'dist'), join(destination, 'dist'), { recursive: true, dereference: true })
  for (const entry of closure) {
    copyDereferenced(entry.directory, join(destination, 'node_modules', ...entry.name.split('/')))
  }
  stripVendoredSources(destination)

  const provenance = {
    schemaVersion: 1,
    package: REDTEAM_RUNNER_PACKAGE,
    version: manifest.version,
    source,
    // The lockfile the closure's exact versions were resolved from. The digest
    // lets a packaged install be matched against the source workspace without it.
    lockfile: { source: lockfile.path, sha256: lockfile.sha256 },
    // The list a reviewer (and the payload test) checks the shipped tree against.
    packages: closure.map(entry => ({ name: entry.name, version: entry.version })),
    // Written so the exclusion is visible rather than looking like an omission.
    excludedOptionalDependencies: [{ name: 'nan', reason: "ssh2's build-time C++ header; an optional dependency by contract" }],
  }
  writeFileSync(join(destination, 'provenance.json'), `${JSON.stringify(provenance, undefined, 2)}\n`)
  return { version: manifest.version, packages: provenance.packages }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const { from } = parseArguments(process.argv.slice(2))
  const result = vendorRedteamRunner({ from })
  process.stdout.write(`vendor-redteam-runner: ${REDTEAM_RUNNER_PACKAGE}@${result.version} and ${String(result.packages.length)} dependencies â†’ ${join(APP_ROOT, REDTEAM_RUNNER_PAYLOAD)}\n`)
}


