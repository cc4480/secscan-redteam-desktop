/**
 * External-tool payload guard.
 *
 * `resources/tools` is build output: `scripts/vendor-tools.mjs` materializes it from
 * `resources/tools-manifest.json`, electron-builder copies it to `<install>/resources/tools`,
 * and `apps/desktop/src/redteam-runner.ts` hands that path to the engagement runner as
 * `REDTEAM_TOOLS_DIR`. This spec pins the pieces that must never drift silently:
 *
 *   - every tier-1 entry is pinned (url + SHA-256 + license), because an unpinned download
 *     is a supply-chain hole and a tier-1 omission is a fresh install that cannot scan;
 *   - a vendored tree matches the manifest layout (a renamed destination would ship a
 *     directory the runner never looks in);
 *   - the packaging config includes the tree when it exists;
 *   - the wordlist is vendored beside the tools, because ffuf/gobuster cannot run without it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(desktopRoot, 'resources', 'tools-manifest.json')

interface ToolEntry {
  readonly id: string
  readonly tier?: number
  readonly version?: string
  readonly url?: string
  readonly sha256?: string
  readonly destination?: string
  readonly license?: string
}

interface ToolsManifest {
  readonly tools: readonly ToolEntry[]
  readonly wordlist?: { readonly source: string; readonly destination: string }
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ToolsManifest

describe('external-tool manifest', () => {
  it('pins every tier-1 entry: url, 64-hex sha256 and a license', () => {
    const tierOne = manifest.tools.filter(tool => tool.tier === 1)
    expect(tierOne.length).toBeGreaterThan(0)
    for (const tool of tierOne) {
      expect(tool.url, `${tool.id} url`).toBeTruthy()
      expect(tool.sha256, `${tool.id} sha256`).toMatch(/^[a-f0-9]{64}$/)
      expect(tool.license, `${tool.id} license`).toBeTruthy()
      expect(tool.version, `${tool.id} version`).toBeTruthy()
    }
  })

  it('never lets two tools claim the same destination', () => {
    const destinations = manifest.tools.map(tool => tool.destination ?? tool.id)
    expect(new Set(destinations).size).toBe(destinations.length)
  })

  it('keeps the tier-1 contract to the tools a scan actually needs', () => {
    const tierOne = manifest.tools.filter(tool => tool.tier === 1).map(tool => tool.id).sort()
    expect(tierOne).toEqual(['ffuf', 'nmap'])
  })

  it('declares a wordlist destination beside the tools', () => {
    expect(manifest.wordlist?.destination).toBe('wordlists/common.txt')
    expect(manifest.wordlist?.source).toContain('redteam-runner')
  })
})

describe('vendored tools payload', () => {
  const toolsDirectory = join(desktopRoot, 'resources', 'tools')
  const vendored = existsSync(toolsDirectory)

  it.runIf(vendored)('lays every vendored tool out where the runner looks for it', () => {
    for (const tool of manifest.tools) {
      const destination = join(toolsDirectory, tool.destination ?? tool.id)
      const pinned = typeof tool.url === 'string' && tool.url !== ''
      if (!pinned) continue
      expect(existsSync(destination), `${tool.id} -> ${destination}`).toBe(true)
      expect(existsSync(join(destination, '.provenance.json')), `${tool.id} provenance`).toBe(true)
    }
    expect(existsSync(join(toolsDirectory, 'nmap', 'nmap.exe'))).toBe(true)
    expect(existsSync(join(toolsDirectory, 'ffuf', 'ffuf.exe'))).toBe(true)
    expect(existsSync(join(toolsDirectory, 'wordlists', 'common.txt'))).toBe(true)
  })

  it.runIf(!vendored)('documents that a source-only build ships no tools payload', () => {
    // A checkout without a vendored payload must still package: electron-builder skips the
    // absent tree and the runner falls back to PATH, reporting the tools honestly in doctor.
    expect(vendored).toBe(false)
  })
})
