/**
 * Packaging gate for the bundled llama.cpp runtime.
 *
 * The local-model manager starts `llama-server.exe` from `<install>/resources/llama`,
 * so an installer without that payload offers a window that can never serve a model.
 * This spec pins the three pieces that make the payload trustworthy at build time:
 *
 *   - `resources/llama-manifest.json` names one Windows x64 CPU release with a pinned
 *     URL and SHA-256, and keeps the launcher plus every shared library it loads;
 *   - `scripts/vendor-llama.mjs --check` passes against the materialized payload, and
 *     the spec only runs that gate when the payload actually exists (it is build
 *     output, not source);
 *   - the electron-builder configuration ships the payload as the `llama`
 *     extraResource, and its Windows x64 `beforePack` refuses a build whose fixture
 *     directory is missing the launcher or the shared libraries.
 *
 * Every payload is a temp-directory fixture passed as the packaging environment, so
 * the real `resources/llama` checkout is never mutated and no download happens.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

/** Absolute `apps/desktop` directory, resolved from this spec's own location. */
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The pinned payload manifest the vendor script and the supervisor both read. */
const manifestPath = join(desktopRoot, 'resources', 'llama-manifest.json')

/** The vendor script's `--check` mode is the packaging gate. */
const vendorScript = join(desktopRoot, 'scripts', 'vendor-llama.mjs')

/** Where electron-builder expects the materialized payload. */
const payloadDirectory = join(desktopRoot, 'resources', 'llama')

/** One pinned runtime release. */
interface LlamaRelease {
  readonly id?: string
  readonly version?: string
  readonly url?: string
  readonly sha256?: string
  readonly archive?: string
  readonly stripDirectory?: string
  readonly destination?: string
  readonly license?: string
  readonly keep?: readonly string[]
}

/** The manifest document. */
interface LlamaManifest {
  readonly version?: number
  readonly releases?: readonly LlamaRelease[]
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LlamaManifest
const releases = manifest.releases ?? []
const release = releases[0] ?? {}

/** Temp fixtures owned by a test, removed after it. */
const roots: string[] = []

/** The llama payload directory as it was when this spec loaded, restored after each test. */
const originalLlamaDirectory = process.env.DSH_DESKTOP_LLAMA_DIR

afterEach(() => {
  // The directory seam is also a process environment variable; put back whatever was
  // there before the test so a packaging gate later in the same run sees its own value.
  if (originalLlamaDirectory === undefined) delete process.env.DSH_DESKTOP_LLAMA_DIR
  else process.env.DSH_DESKTOP_LLAMA_DIR = originalLlamaDirectory
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** @returns a fresh temp directory owned by this spec. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llama-packaging-'))
  roots.push(root)
  return root
}

/**
 * Build a temp directory shaped like a vendored payload.
 * @param names - payload files to write; a name ending in `.exe` gets an `MZ` header.
 * @returns the fixture directory.
 */
function payloadFixture(names: readonly string[]): string {
  const directory = tempRoot()
  for (const name of names) writeFileSync(join(directory, name), name.endsWith('.exe') ? 'MZ llama fixture' : 'llama fixture')
  return directory
}

/**
 * Minimal unsigned win-x64 packaging environment for the configuration factory.
 * @param llamaDirectory - payload the factory must package, or a path that does not exist.
 * @returns the environment the factory and its `beforePack` closure consume.
 */
function packagingEnvironment(llamaDirectory: string): NodeJS.ProcessEnv {
  // Mirrored into the process environment for the duration of the test; afterEach
  // restores it. The returned object is what the factory actually reads.
  process.env.DSH_DESKTOP_LLAMA_DIR = llamaDirectory
  return {
    DSH_DESKTOP_APP_ID: 'com.secscan.redteam',
    DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.test',
    DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.test'] }),
    DSH_DESKTOP_UNSIGNED: '1',
    DSH_DESKTOP_LLAMA_DIR: llamaDirectory,
  }
}

/**
 * A `beforePack` context. The llama gate throws before it reads the packager, so an
 * empty configuration object is the whole context the failing path needs.
 * @returns a context with the one member the gate could reach.
 */
function beforePackContext(): { packager: { config: Record<string, unknown> } } {
  return { packager: { config: {} } }
}

/** @returns the failure a `beforePack` run reported, for one assertion to read its message. */
async function beforePackFailure(config: ReturnType<typeof createElectronBuilderConfig>): Promise<Error> {
  const failure = await config.beforePack(beforePackContext() as unknown as Parameters<typeof config.beforePack>[0]).then(() => undefined, (error: unknown) => error)
  if (!(failure instanceof Error)) throw new Error('the packaging gate accepted an incomplete llama payload')
  return failure
}

/** @returns the llama extraResources mapping the factory produced, if any. */
function llamaResourceEntries(config: ReturnType<typeof createElectronBuilderConfig>) {
  const entries = Array.isArray(config.extraResources) ? config.extraResources : []
  return entries.filter(entry => typeof entry === 'object' && entry !== null && (entry as { to?: string }).to === 'llama')
}

// The payload is build output and is gitignored, so a source-only checkout must still
// load this spec; only a materialized payload can be checked by the vendor gate.
const payloadVendored = existsSync(join(payloadDirectory, 'llama-server.exe'))

describe('pinned llama.cpp manifest', () => {
  it('pins one Windows x64 CPU release with a verified archive and MIT license', () => {
    expect(manifest.version).toBe(1)
    expect(releases).toHaveLength(1)
    expect(release.id).toBe('llama')
    expect(release.version).toMatch(/^b\d+$/u)
    expect(release.url).toBe(
      `https://github.com/ggml-org/llama.cpp/releases/download/${release.version}/llama-${release.version}-bin-win-cpu-x64.zip`,
    )
    // An unpinned download is a supply-chain hole: the SHA-256 must be a real digest.
    expect(release.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(release.sha256).not.toMatch(/^0+$/u)
    expect(release.archive).toBe('zip')
    expect(release.destination).toBe('llama')
    expect(release.license).toBe('MIT')
  })

  it('keeps the server launcher and every shared library it loads', () => {
    const keep = release.keep ?? []
    // llama-server.exe is a thin launcher; its -impl, llama and GGML DLLs are required too.
    expect(keep).toContain('llama-server.exe')
    expect(keep).toContain('*.dll')
  })
})

describe('vendor --check packaging gate', () => {
  it.runIf(payloadVendored)('passes against the materialized payload', () => {
    const result = spawnSync(process.execPath, [vendorScript, '--check'], { encoding: 'utf8', windowsHide: true })
    expect(result.stderr.trim()).toBe('')
    expect(result.stdout).toContain('[llama] ok llama')
    expect(result.status).toBe(0)
  })

  it.runIf(!payloadVendored)('documents that a source-only checkout ships no payload', () => {
    // `--check` needs a vendored tree; the packaging build must materialize it first.
    expect(payloadVendored).toBe(false)
  })
})

describe('electron-builder llama payload', () => {
  it('ships the vendored payload as the llama extraResource', () => {
    const fixture = payloadFixture(['llama-server.exe', 'ggml.dll', 'LICENSE-LLVM-OpenMP'])

    const config = createElectronBuilderConfig(packagingEnvironment(fixture), 'win32', 'x64')

    expect(llamaResourceEntries(config)).toEqual([{ from: fixture, to: 'llama', filter: ['**/*'] }])
  })

  it('leaves the llama resource out when the packaging environment names no payload', () => {
    const missing = join(tempRoot(), 'not-vendored')
    // The directory does not exist, so a source-only build still packages without it;
    // only the Windows x64 `beforePack` then refuses the installer.
    const config = createElectronBuilderConfig(packagingEnvironment(missing), 'win32', 'x64')

    expect(llamaResourceEntries(config)).toEqual([])
  })

  it('refuses a Windows x64 build whose payload has no llama-server.exe', async () => {
    const fixture = payloadFixture(['ggml.dll'])
    const config = createElectronBuilderConfig(packagingEnvironment(fixture), 'win32', 'x64')

    const failure = await beforePackFailure(config)

    expect(failure.message).toContain(join(fixture, 'llama-server.exe'))
    expect(failure.message).toContain('run node apps/desktop/scripts/vendor-llama.mjs')
  })

  it('refuses a Windows x64 build whose payload has no shared libraries', async () => {
    const fixture = payloadFixture(['llama-server.exe'])
    const config = createElectronBuilderConfig(packagingEnvironment(fixture), 'win32', 'x64')

    const failure = await beforePackFailure(config)

    expect(failure.message).toContain('holds no shared libraries')
    expect(failure.message).toContain('run node apps/desktop/scripts/vendor-llama.mjs')
  })
})
