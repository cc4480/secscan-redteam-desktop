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

/** The llm-router package: the fleet's charter, exemplar pack and SOUL live in it. */
const LLM_ROUTER_PACKAGE = '@secscan/redteam-llm-router'

/** The fleet-skills package: the fleet's skill library and prompt assets live in it. */
const FLEET_SKILLS_PACKAGE = '@secscan/redteam-fleet-skills'

/**
 * The fleet-skills package's prompt and skill assets: every
 * `skills/<name>/SKILL.md` bundle, `prompts/master.md`,
 * `prompts/seats/*.md` and `prompts/souls/*.md`. The payload exclusions
 * drop every `.md` file, so a payload assembled by the copy alone
 * contains none of these — and the fleet's loaders fail loud on a
 * missing asset. {@link placeFleetSkillsAssets} puts them back at the
 * one payload-stable location the runner-side loading resolves from the
 * vendored tree: `lib/fleet-skills/` beside the package's bundled
 * module (mirroring `lib/charter/` for the llm-router, whose own
 * candidates put the vendored `lib/` location first). The source-tree
 * candidate the same loaders try is the package's own `skills/` and
 * `prompts/` directories, which is where the placement reads from.
 */

/**
 * The llm-router's prompt assets. The payload exclusions drop every `.md`
 * file and {@link stripVendoredSources} deletes the vendored `src/` trees,
 * so a payload assembled by the copy alone contains none of these — and the
 * fleet's loaders fail loud on a missing asset, which would make every
 * chartered call throw inside a user's install. {@link placeCharterAssets}
 * puts them back at the one payload-stable location the loaders resolve
 * first: `lib/charter/` beside the bundled module.
 */
const CHARTER_ASSETS = ['charter.md', 'exemplars.md', 'soul.md']

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
export function copyDereferenced(from, to) {
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

/** The Scribe (publisher seat) modules the assembled payload must carry. */
const SCRIBE_PAYLOAD_FILES = ['report/scribe.js', 'report/scribe-html.js']

/**
 * Fail the vendoring run when the assembled payload lacks the Scribe.
 *
 * The desktop application executes this payload, not the runner source
 * tree. A payload assembled from a source snapshot that predates the
 * Scribe seat shipped with no Scribe at all — the 2026-11-01 revendor
 * (17:43) predates the seat's landing (19:11) — so every engagement the
 * desktop ran completed without the publisher sign-off gate and nothing
 * failed. Asserting the seat's modules and its gate call in the
 * engagement close keeps that stale-payload class from shipping again
 * silently.
 * @param {string} payloadRoot - The vendored payload root to inspect.
 */
export function assertScribeInPayload(payloadRoot) {
  const dist = join(payloadRoot, 'dist')
  const missing = SCRIBE_PAYLOAD_FILES.filter(file => !existsSync(join(dist, ...file.split('/'))))
  const runPath = join(dist, 'phases', 'run.js')
  if (!existsSync(runPath)) {
    missing.push('phases/run.js')
  } else if (!readFileSync(runPath, 'utf8').includes('scribeGate')) {
    missing.push('phases/run.js (no scribeGate call)')
  }
  if (missing.length > 0) {
    throw new Error(`vendor-redteam-runner: the payload at ${payloadRoot} is missing the Scribe (${missing.join(', ')}); the desktop application executes this payload, so shipping it would run engagements with no publisher sign-off`)
  }
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

/**
 * Place the llm-router's prompt assets into the vendored payload.
 *
 * The copy exclusions and the `src/` strip leave the payload without a
 * single charter asset (see {@link CHARTER_ASSETS}); the loaders' first
 * candidate is `charter/<asset>` beside the bundled module, so the assets
 * are copied from the source package's `src/charter/` to the payload's
 * `node_modules/@secscan/redteam-llm-router/lib/charter/`. A missing source
 * asset fails the vendoring run: shipping without one is not a smaller
 * payload, it is a broken one.
 * @param {string} sourcePackageDirectory - The llm-router package directory in the source tree.
 * @param {string} destination - The vendored payload root.
 * @returns {string[]} The placed asset paths, relative to the payload root.
 */
export function placeCharterAssets(sourcePackageDirectory, destination) {
  const from = join(sourcePackageDirectory, 'src', 'charter')
  const target = join(destination, 'node_modules', ...LLM_ROUTER_PACKAGE.split('/'), 'lib', 'charter')
  mkdirSync(target, { recursive: true })
  const placed = []
  for (const name of CHARTER_ASSETS) {
    const asset = join(from, name)
    if (!existsSync(asset)) {
      throw new Error(`vendor-redteam-runner: charter asset ${name} is missing from ${from}; the payload would ship without it and every chartered call would fail inside the install`)
    }
    cpSync(asset, join(target, name))
    placed.push(join('node_modules', ...LLM_ROUTER_PACKAGE.split('/'), 'lib', 'charter', name))
  }
  return placed
}

/**
 * Place the fleet-skills package's prompt and skill assets into the
 * vendored payload.
 *
 * The copy exclusions drop every `.md` (see {@link CHARTER_ASSETS} for
 * the same failure in the llm-router), so the assets are copied from
 * the source package's `skills/` and `prompts/` trees to the payload's
 * `node_modules/@secscan/redteam-fleet-skills/lib/fleet-skills/`,
 * preserving their relative layout (`skills/<name>/SKILL.md`,
 * `prompts/master.md`, `prompts/seats/*.md`, `prompts/souls/*.md`).
 * The bundle set is enumerated from the source tree rather than
 * hard-coded, so a skill added to the library ships without a second
 * edit here. A missing or empty source location fails the vendoring
 * run: shipping without one of these is not a smaller payload, it is a
 * broken one.
 * @param {string} sourcePackageDirectory - The fleet-skills package directory in the source tree.
 * @param {string} destination - The vendored payload root.
 * @returns {string[]} The placed asset paths, relative to the payload root.
 */
export function placeFleetSkillsAssets(sourcePackageDirectory, destination) {
  const targetRoot = join(destination, 'node_modules', ...FLEET_SKILLS_PACKAGE.split('/'), 'lib', 'fleet-skills')
  const placed = []
  const place = (from, relativePath) => {
    if (!existsSync(from)) {
      throw new Error(`vendor-redteam-runner: fleet-skills asset ${relativePath} is missing from ${sourcePackageDirectory}; the payload would ship without it and the fleet's loaders would fail inside the install`)
    }
    const target = join(targetRoot, ...relativePath.split('/'))
    mkdirSync(join(target, '..'), { recursive: true })
    cpSync(from, target)
    placed.push(join('node_modules', ...FLEET_SKILLS_PACKAGE.split('/'), 'lib', 'fleet-skills', ...relativePath.split('/')))
  }

  const skillsRoot = join(sourcePackageDirectory, 'skills')
  if (!existsSync(skillsRoot)) {
    throw new Error(`vendor-redteam-runner: fleet-skills skills directory is missing from ${sourcePackageDirectory}; the payload would ship without the skill library`)
  }
  const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  if (skillNames.length === 0) {
    throw new Error(`vendor-redteam-runner: fleet-skills skills directory ${skillsRoot} is empty; the payload would ship without the skill library`)
  }
  for (const name of skillNames) {
    place(join(skillsRoot, name, 'SKILL.md'), `skills/${name}/SKILL.md`)
  }

  place(join(sourcePackageDirectory, 'prompts', 'master.md'), 'prompts/master.md')
  for (const group of ['seats', 'souls']) {
    const groupRoot = join(sourcePackageDirectory, 'prompts', group)
    if (!existsSync(groupRoot)) {
      throw new Error(`vendor-redteam-runner: fleet-skills prompts/${group} directory is missing from ${sourcePackageDirectory}; the payload would ship without it`)
    }
    const files = readdirSync(groupRoot, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name)
      .sort()
    if (files.length === 0) {
      throw new Error(`vendor-redteam-runner: fleet-skills prompts/${group} directory ${groupRoot} holds no .md assets; the payload would ship without them`)
    }
    for (const name of files) {
      place(join(groupRoot, name), `prompts/${group}/${name}`)
    }
  }
  return placed
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
  const llmRouter = closure.find(entry => entry.name === LLM_ROUTER_PACKAGE)
  if (llmRouter === undefined) {
    throw new Error(`vendor-redteam-runner: ${LLM_ROUTER_PACKAGE} is missing from the dependency closure; its charter assets have nowhere to land`)
  }
  const charterAssets = placeCharterAssets(llmRouter.directory, destination)
  const fleetSkills = closure.find(entry => entry.name === FLEET_SKILLS_PACKAGE)
  if (fleetSkills === undefined) {
    throw new Error(`vendor-redteam-runner: ${FLEET_SKILLS_PACKAGE} is missing from the dependency closure; its prompt and skill assets have nowhere to land`)
  }
  const fleetSkillsAssets = placeFleetSkillsAssets(fleetSkills.directory, destination)

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
    // The prompt assets placeCharterAssets put back after the exclusions and
    // the src/ strip removed them; paths are relative to the payload root.
    charterAssets,
    // The prompt and skill assets placeFleetSkillsAssets put back after
    // the exclusions removed them; paths are relative to the payload root.
    fleetSkillsAssets,
    // Written so the exclusion is visible rather than looking like an omission.
    excludedOptionalDependencies: [{ name: 'nan', reason: "ssh2's build-time C++ header; an optional dependency by contract" }],
  }
  writeFileSync(join(destination, 'provenance.json'), `${JSON.stringify(provenance, undefined, 2)}\n`)
  assertScribeInPayload(destination)
  return { version: manifest.version, packages: provenance.packages }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const { from } = parseArguments(process.argv.slice(2))
  const result = vendorRedteamRunner({ from })
  process.stdout.write(`vendor-redteam-runner: ${REDTEAM_RUNNER_PACKAGE}@${result.version} and ${String(result.packages.length)} dependencies â†’ ${join(APP_ROOT, REDTEAM_RUNNER_PAYLOAD)}\n`)
}


