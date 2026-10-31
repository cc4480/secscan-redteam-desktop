/**
 * Packaging guard for the fleet briefs (build brief G-B): role-briefs.ts
 * resolves the package-root `agents/` directory at runtime and apply()
 * fails loud when it is missing — so a package tarball that omits `agents/`
 * bricks the packaged plugin at startup. The desktop packaging packs this
 * package with `pnpm pack` (package-target.ts), whose file list follows
 * npm pack semantics: with no `files` allowlist the whole package ships;
 * the day someone adds a restrictive `files` field, the briefs silently
 * drop out. This test pins the real pack listing so that day goes red
 * here instead of bricking an install. (Negative control, verified at
 * landing: on a copy with `files: ["lib"]` the same listing contains zero
 * agents files and this assertion fails.)
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const AGENT_FILES = [
  'agents/_shared-base.md',
  'agents/coordinator.md',
  'agents/recon.md',
  'agents/exploiter.md',
  'agents/reporter.md',
  'agents/architect.md',
]

describe('packaging', () => {
  it('ships the agents/ doctrine files in the package tarball', () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: packageRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    assert.equal(result.status, 0, `npm pack --dry-run failed: ${result.stderr}`)
    const listing = JSON.parse(result.stdout) as [{ files: { path: string }[] }]
    const shipped = new Set(listing[0]!.files.map(file => file.path))
    for (const expected of AGENT_FILES) {
      assert.ok(shipped.has(expected), `${expected} missing from the package tarball file list`)
    }
  })
})
