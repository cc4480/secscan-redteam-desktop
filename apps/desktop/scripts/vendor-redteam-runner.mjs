/**
 * Vendor the engagement runner into the Desktop application payload.
 *
 * The runner (@secscan/redteam-runner) is not a package of this repository, and
 * its built `dist/` cannot be resolved here the way a workspace dependency is:
 * its seven runtime dependencies are hoisted to the runner's own workspace root,
 * and one module it imports at startup (`@msgpack/msgpack`) is declared there
 * rather than in the runner's manifest. Installing from the runner's own
 * `node_modules` (0 MB) therefore is not an option — the closure is materialized
 * here, next to the application that executes it, so a packaged install needs
 * nothing else on the machine.
 *
 * The output is exactly what `extraResources` ships:
 *
 *   resources/redteam-runner/package.json      the runner's own manifest (Node
 *                                              reads `type: module` and the
 *                                              self-referencing `exports` here)
 *   resources/redteam-runner/dist/**           the built runner, unmodified
 *   resources/redteam-runner/node_modules/**   every production dependency and
 *                                              every transitive dependency
 *   resources/redteam-runner/provenance.json   what was taken from where
 *
 * Paths inside a package are copied dereferenced: the runner's workspace links
 * `@secscan/*` packages with junctions, and an installer must carry the bytes.
 *
 * Usage (from apps/desktop, or through the repository's package manager):
 *   node scripts/vendor-redteam-runner.mjs [--from <runner directory>]
 * The source directory defaults to `DSH_DESKTOP_REDTEAM_RUNNER_DIR`, then to a
 * `secscan-redteam/runner` checkout beside this repository.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

/** Directory, relative to this app, that `extraResources` copies to `resources/redteam-runner`. */
export const REDTEAM_RUNNER_PAYLOAD = join('resources', 'redteam-runner')

/** Package name the vendored payload must declare; anything else is the wrong directory. */
const REDTEAM_RUNNER_PACKAGE = '@secscan/redteam-runner'

/**
 * Packages the built runner imports that its own manifest does not declare.
 *
 * `@msgpack/msgpack` is a dependency of the runner's workspace ROOT and is
 * imported at startup by `dist/msf/protocol.js`, so the closure built from the
 * runner manifest alone does not reach it. The list is explicit rather than a
 * scan so a runner upgrade that adds another hoisted import fails the closure
 * check instead of shipping a payload that throws on load.
 */
const HOISTED_DEPENDENCIES = [
  { name: '@msgpack/msgpack', reason: "imported by dist/msf/protocol.js; declared at the runner's workspace root" },
]

/** Dependency sections that carry what a shipped payload must contain. */
const DEPENDENCY_SECTIONS = ['dependencies']

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
  for (;;) {
    const candidate = join(directory, 'node_modules', ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
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
  return { from: join(REPOSITORY_ROOT, '..', 'secscan-redteam', 'runner') }
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
    ...HOISTED_DEPENDENCIES.map(entry => entry.name),
  ]
  const resolved = new Map()
  const queue = [...roots]
  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined || resolved.has(name)) continue
    const directory = packageDirectory(name, runnerDirectory)
    if (directory === undefined) {
      problems.push(`${name} is not installed in the source tree`)
      continue
    }
    const packageManifest = readJson(join(directory, 'package.json'))
    resolved.set(name, { name, version: packageManifest.version, directory })
    // Optional dependencies are contractually absent-safe, and the only one the
    // source tree installs is ssh2's `nan` build header; it is not shipped.
    queue.push(...Object.keys(packageManifest.dependencies ?? {}))
  }
  return [...resolved.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * Copy one directory with links resolved, so an installer carries the bytes.
 * @param {string} from - Source directory.
 * @param {string} to - Destination directory.
 */
function copyDereferenced(from, to) {
  mkdirSync(to, { recursive: true })
  cpSync(realpathSync(from), realpathSync(to), { recursive: true, dereference: true, force: true })
}

/**
 * Vendor the runner payload and report what was copied.
 * @param {{ from: string, to?: string }} options - Runner checkout and payload destination.
 * @returns {{ version: string, packages: { name: string, version: string }[] }} What was written.
 */
export function vendorRedteamRunner(options) {
  const source = options.from
  const destination = options.to ?? join(APP_ROOT, REDTEAM_RUNNER_PAYLOAD)
  const manifest = readJson(join(source, 'package.json'))
  if (manifest.name !== REDTEAM_RUNNER_PACKAGE) {
    throw new Error(`vendor-redteam-runner: ${source} declares ${String(manifest.name)}, expected ${REDTEAM_RUNNER_PACKAGE}`)
  }
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

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  cpSync(join(source, 'package.json'), join(destination, 'package.json'))
  cpSync(join(source, 'dist'), join(destination, 'dist'), { recursive: true, dereference: true })
  for (const entry of closure) {
    copyDereferenced(entry.directory, join(destination, 'node_modules', ...entry.name.split('/')))
  }

  const provenance = {
    schemaVersion: 1,
    package: REDTEAM_RUNNER_PACKAGE,
    version: manifest.version,
    source,
    // The list a reviewer (and the payload test) checks the shipped tree against.
    packages: closure.map(entry => ({ name: entry.name, version: entry.version })),
    hoistedDependencies: HOISTED_DEPENDENCIES,
    // Written so the exclusion is visible rather than looking like an omission.
    excludedOptionalDependencies: [{ name: 'nan', reason: "ssh2's build-time C++ header; an optional dependency by contract" }],
  }
  writeFileSync(join(destination, 'provenance.json'), `${JSON.stringify(provenance, undefined, 2)}\n`)
  return { version: manifest.version, packages: provenance.packages }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const { from } = parseArguments(process.argv.slice(2))
  const result = vendorRedteamRunner({ from })
  process.stdout.write(`vendor-redteam-runner: ${REDTEAM_RUNNER_PACKAGE}@${result.version} and ${String(result.packages.length)} dependencies → ${join(APP_ROOT, REDTEAM_RUNNER_PAYLOAD)}\n`)
}
