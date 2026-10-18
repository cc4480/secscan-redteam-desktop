/**
 * Bundled llama.cpp runtime guard.
 *
 * `resources/llama` is build output: `scripts/vendor-llama.mjs` materializes it from
 * `resources/llama-manifest.json`, electron-builder copies it to `<install>/resources/llama`,
 * and the local-model manager starts `llama-server.exe` from there. This spec pins the
 * pieces that must never drift silently:
 *
 *   - the runtime release is pinned (non-empty url + 64-hex SHA-256 + license), because an
 *     unpinned download is a supply-chain hole;
 *   - the keep list is a real runtime: `llama-server.exe` plus every `*.dll`, since the exe
 *     is a thin launcher and its `-impl`, llama, GGML and CPU-backend DLLs must ship beside it;
 *   - `--check` (the packaging gate) passes against a materialized payload. The test never
 *     downloads: it only runs the gate, and only when the payload is already vendored.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(desktopRoot, 'resources', 'llama-manifest.json')
const vendorScript = join(desktopRoot, 'scripts', 'vendor-llama.mjs')
const payloadDirectory = join(desktopRoot, 'resources', 'llama')

interface LlamaRelease {
  readonly id: string
  readonly version?: string
  readonly url?: string
  readonly sha256?: string
  readonly archive?: string
  readonly stripDirectory?: string
  readonly destination?: string
  readonly license?: string
  readonly keep?: readonly string[]
}

interface LlamaManifest {
  readonly version: number
  readonly releases: readonly LlamaRelease[]
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LlamaManifest
const releases = manifest.releases
const release = releases[0]

describe('bundled llama.cpp manifest', () => {
  it('pins the Windows x64 CPU runtime release', () => {
    expect(releases).toHaveLength(1)
    expect(release!.id).toBe('llama')
    expect(release!.version).toBe('b11669')
    expect(release!.url).toBe('https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-win-cpu-x64.zip')
    expect(release!.sha256).toBe('37b3efcf962847ca869745fd4ccf7f5e7e8dacfeff9fa3523b4ca8cdc66d632b')
    expect(release!.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(release!.archive).toBe('zip')
    expect(release!.destination).toBe('llama')
    expect(release!.license).toBe('MIT')
    // The b11669 win-cpu-x64 archive extracts flat; a top-level folder would need a strip.
    expect(release!.stripDirectory).toBe('')
  })

  it('keeps llama-server plus every shared library', () => {
    const keep = release!.keep ?? []
    expect(keep).toContain('llama-server.exe')
    expect(keep).toContain('*.dll')
    // Anything else retained must be a license notice, never another tool binary.
    for (const pattern of keep) {
      if (pattern === 'llama-server.exe' || pattern === '*.dll') continue
      expect(pattern.toUpperCase()).toContain('LICENSE')
    }
  })
})

describe('vendored llama.cpp payload', () => {
  const vendored = existsSync(join(payloadDirectory, 'llama-server.exe'))

  it.runIf(vendored)('passes the vendor --check packaging gate', () => {
    const result = spawnSync(process.execPath, [vendorScript, '--check'], { encoding: 'utf8', windowsHide: true })
    expect(result.stderr, 'vendor-llama --check stderr').toBe('')
    expect(result.stdout).toContain('ok llama')
    expect(result.status, 'vendor-llama --check exit code').toBe(0)
  })

  it.runIf(!vendored)('documents that a source-only build ships no llama payload', () => {
    // A checkout without a vendored payload must still load this spec: the packaging
    // gate above only runs once `node apps/desktop/scripts/vendor-llama.mjs` has run,
    // and electron-builder refuses the Windows x64 installer without it.
    expect(vendored).toBe(false)
  })
})
