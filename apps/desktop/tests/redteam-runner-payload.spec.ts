/**
 * What the packaged application actually ships as its engagement engine.
 *
 * `apps/desktop/src/redteam-runner.ts` executes this tree with the bundled runtime
 * and nothing else, so every file it imports has to be inside it: a dependency the
 * vendoring step missed would surface as a missing module on an operator's machine,
 * at the moment a tool is called, with no build-time signal otherwise. The runner's
 * own `dist` is the input and cannot be changed, which is why the hole is closed
 * here rather than in the runner.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REDTEAM_RUNNER_ENTRY, REDTEAM_RUNNER_RESOURCE_DIRECTORY, redteamRunnerResources } from '../src/redteam-runner.ts'

/** Vendored payload root, as `extraResources` copies it to `resources/redteam-runner`. */
const PAYLOAD = fileURLToPath(new URL(`../resources/${REDTEAM_RUNNER_RESOURCE_DIRECTORY}`, import.meta.url))

/** Absolute path inside the payload. */
const inPayload = (...parts: string[]): string => join(PAYLOAD, ...parts)

/** A package manifest, as far as the closure walk needs it. */
interface Manifest {
  readonly name: string
  readonly version: string
  readonly dependencies?: Record<string, string>
  readonly exports?: unknown
  readonly main?: string
}

/** @returns the parsed manifest. */
function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest
}

/**
 * Resolve a package directory the way Node does from one file, without executing it.
 * @param name - Package name, possibly scoped.
 * @param from - Directory to resolve from.
 * @returns Absolute package directory, or undefined when nothing satisfies it.
 */
function packageDirectory(name: string, from: string): string | undefined {
  let directory = from
  for (;;) {
    const candidate = join(directory, 'node_modules', ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/** Every `.js` file under a directory. */
function javascriptFiles(directory: string): string[] {
  const files: string[] = []
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(child)
    }
  }
  visit(directory)
  return files
}

/** An import specifier that Node resolves through `node_modules` rather than a relative path. */
const BARE_SPECIFIER = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(\/[a-z0-9._-]+)*$/u

/**
 * Collect the bare specifiers a compiled module imports.
 *
 * The runner's `dist` is TypeScript output plus its comments, so the specifiers are
 * read from statements that START a line - which is how the compiler emits imports -
 * after comments are removed. Prose inside a comment or a string is therefore not
 * mistaken for an import, and a fixture whose import the compiler wrapped onto two
 * lines is still found.
 * @param source - Compiled module text.
 * @returns Bare specifiers, sorted and deduplicated.
 */
function bareSpecifiers(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:\\])\/\/[^\n]*/gu, '$1')
  const found = new Set<string>()
  const patterns = [
    /^import\b[\s\S]{0,400}?from\s*["']([^"']+)["']/gmu,
    /^import\s+["']([^"']+)["']/gmu,
    /^[ \t]*import\s*\(\s*["']([^"']+)["']\s*\)/gmu,
    /^export\b[\s\S]{0,400}?from\s*["']([^"']+)["']/gmu,
  ]
  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier === undefined || specifier.startsWith('.') || specifier.startsWith('/')) continue
      if (specifier.startsWith('node:')) continue
      if (!BARE_SPECIFIER.test(specifier)) continue
      found.add(specifier)
    }
  }
  return [...found].sort()
}

describe('bundled engagement runner payload', () => {
  it('carries the entry point, the dashboard assets and the provenance of what was taken', () => {
    expect(existsSync(inPayload(REDTEAM_RUNNER_ENTRY))).toBe(true)
    const runner = manifest(inPayload('package.json'))
    expect(runner.name).toBe('@secscan/redteam-runner')
    // Node reads `type: module` and the self-referencing `exports` from this manifest, so
    // the payload cannot work without it.
    expect(JSON.parse(readFileSync(inPayload('package.json'), 'utf8'))).toMatchObject({ type: 'module' })
    // The console serves its dashboard from `public/` beside its own module.
    expect(existsSync(inPayload('dist', 'ui', 'public', 'index.html'))).toBe(true)

    const provenance = JSON.parse(readFileSync(inPayload('provenance.json'), 'utf8')) as {
      package: string
      version: string
      packages: { name: string; version: string }[]
      excludedOptionalDependencies: { name: string }[]
    }
    expect(provenance.package).toBe('@secscan/redteam-runner')
    expect(provenance.version).toBe(runner.version)
    // A provenance file that no longer matches the tree it describes is worse than none.
    for (const entry of provenance.packages) {
      expect(manifest(inPayload('node_modules', ...entry.name.split('/'), 'package.json')).version, entry.name).toBe(entry.version)
    }
    for (const excluded of provenance.excludedOptionalDependencies) {
      expect(existsSync(inPayload('node_modules', ...excluded.name.split('/'))), excluded.name).toBe(false)
    }
  })

  it('resolves every declared dependency, transitively, inside the payload', () => {
    const runner = manifest(inPayload('package.json'))
    const seen = new Set<string>()
    const problems: string[] = []
    const queue = Object.keys(runner.dependencies ?? {})
    while (queue.length > 0) {
      const name = queue.shift()
      if (name === undefined || seen.has(name)) continue
      seen.add(name)
      const directory = packageDirectory(name, inPayload('dist'))
      if (directory === undefined) {
        problems.push(`${name} is not in the payload`)
        continue
      }
      // Resolution must stay inside the payload: a package that only resolves through
      // the repository's own node_modules is absent from a packaged install.
      if (relative(PAYLOAD, directory).startsWith('..')) {
        problems.push(`${name} resolves outside the payload (${directory})`)
        continue
      }
      queue.push(...Object.keys(manifest(join(directory, 'package.json')).dependencies ?? {}))
    }
    expect(problems).toEqual([])
    // The runner's own manifest declares seven; the closure is much larger.
    expect(seen.size).toBeGreaterThan(7)
  })

  it('resolves every bare import of the runner module graph inside the payload', () => {
    const require = createRequire(inPayload(...REDTEAM_RUNNER_ENTRY.split('/')))
    /**
     * Locate one import target. A package that refuses `require.resolve`'s conditions -
     * an ESM-only package would - is still located by name, because what this asserts is
     * presence in the payload, not the export condition Node picks.
     */
    const locate = (specifier: string, from: string): string | undefined => {
      try {
        return require.resolve(specifier)
      } catch {
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
        return packageDirectory(name, dirname(from))
      }
    }
    const problems: string[] = []
    for (const file of javascriptFiles(inPayload('dist'))) {
      for (const specifier of bareSpecifiers(readFileSync(file, 'utf8'))) {
        const resolved = locate(specifier, file)
        if (resolved === undefined) {
          problems.push(`${relative(PAYLOAD, file)} imports ${specifier}, which the payload does not contain`)
          continue
        }
        if (relative(PAYLOAD, resolved).startsWith('..')) {
          problems.push(`${relative(PAYLOAD, file)} imports ${specifier}, which resolves outside the payload (${resolved})`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('imports the module that is not declared by the runner manifest', () => {
    // The hoisted dependency this payload exists to catch: the runner's manifest does not
    // declare it, so a closure built from that manifest alone would ship without it and
    // fail at load. Kept as an assertion so a stubbed specifier list cannot hide it.
    const imported = new Set(javascriptFiles(inPayload('dist'))
      .flatMap(file => bareSpecifiers(readFileSync(file, 'utf8'))))
    expect(imported.has('@msgpack/msgpack')).toBe(true)
    expect(existsSync(inPayload('node_modules', '@msgpack', 'msgpack', 'package.json'))).toBe(true)
  })

  it('is the directory an unpackaged launch resolves, so the tests and the app read one tree', () => {
    const appRoot = fileURLToPath(new URL('../', import.meta.url))
    const resolved = redteamRunnerResources({
      packaged: false, resourcesPath: join(appRoot, 'resources'), appPath: appRoot, node: 'electron',
    })
    expect(resolved.directory).toBe(PAYLOAD)
    expect(REDTEAM_RUNNER_ENTRY.split('/')).toEqual(['dist', 'cli.js'])
    expect(relative(PAYLOAD, inPayload(...REDTEAM_RUNNER_ENTRY.split('/'))).split(sep).join('/')).toBe(REDTEAM_RUNNER_ENTRY)
  })
})
