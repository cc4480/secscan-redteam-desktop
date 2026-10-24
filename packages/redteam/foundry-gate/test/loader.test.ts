/**
 * Loader and integrity checks against the shipped snapshot: every bundle's
 * recomputed hash must match the manifest, and a tampered copy must not.
 */
import assert from 'node:assert/strict'
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { bundleHash } from '../src/hash.js'
import {
  bundleDir,
  defaultSnapshotDir,
  listBundles,
  loadManifest,
  loadSpec,
  verifyBundle,
  verifySnapshot,
} from '../src/loader.js'

const snapshotDir = defaultSnapshotDir()

describe('snapshot loader', () => {
  test('manifest lists 36 bundles, 2 of them GOLD', () => {
    const manifest = loadManifest(snapshotDir)
    assert.equal(manifest.bundles.length, 36)
    const gold = listBundles(manifest, { loopTier: 'GOLD' })
    assert.deepEqual(gold.map(entry => entry.slug), ['sqli-product-search', 'xss-reflected-search'])
    assert.equal(listBundles(manifest, { vulnClass: 'ssrf' }).length, 9)
    assert.equal(listBundles(manifest).length, 36)
  })

  test('every shipped bundle hash matches the manifest', () => {
    const results = verifySnapshot(snapshotDir)
    assert.equal(results.length, 36)
    for (const result of results) {
      assert.equal(result.ok, true, `${result.slug}: expected ${result.expected}, got ${result.actual}`)
    }
  })

  test('loadSpec returns the frozen spec for a bundle', () => {
    const spec = loadSpec(snapshotDir, 'sqli-product-search')
    assert.equal(spec.slug, 'sqli-product-search')
    assert.equal(spec.vuln_class, 'sql-injection')
    assert.equal(spec.marker, 'FNDRY-SQLI-7Q2X9')
    assert.equal(spec.tier, 1)
  })

  test('a tampered bundle file fails verification', () => {
    const manifest = loadManifest(snapshotDir)
    const entry = manifest.bundles.find(candidate => candidate.slug === 'sqli-product-search')
    assert.ok(entry)
    const tmp = mkdtempSync(join(tmpdir(), 'foundry-gate-tamper-'))
    try {
      const snap = join(tmp, 'snapshot')
      const dest = join(snap, 'bundles', entry.slug)
      cpSync(bundleDir(snapshotDir, entry.slug), dest, { recursive: true })
      assert.equal(verifyBundle(snap, entry).ok, true)
      const before = bundleHash(dest)
      appendFileSync(join(dest, 'probe.py'), '\n# tampered\n')
      const check = verifyBundle(snap, entry)
      assert.equal(check.ok, false)
      assert.notEqual(check.actual, entry.bundle_hash)
      assert.notEqual(bundleHash(dest), before)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
