/**
 * Live end-to-end panel run: boot the GOLD sqli bundle's two variants, run
 * all four layers, and check the graded outcome the Foundry recorded.
 * Needs a Python 3 interpreter; skips when none is available.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { bundleDir, defaultSnapshotDir, loadSpec } from '../src/loader.js'
import { panelRun } from '../src/panel.js'
import { resolvePython } from '../src/runner.js'

const python = resolvePython()
const pythonAvailable = spawnSync(python, ['--version'], { stdio: 'ignore' }).status === 0

describe('panel end-to-end', () => {
  test(
    'sqli-product-search (GOLD) panels [0,1,1,1] at tier 1',
    { skip: pythonAvailable ? false : `no python interpreter (${python})`, timeout: 120_000 },
    async () => {
      const snapshotDir = defaultSnapshotDir()
      const spec = loadSpec(snapshotDir, 'sqli-product-search')
      const result = await panelRun(bundleDir(snapshotDir, 'sqli-product-search'), spec, python)
      assert.deepEqual(result.vector, [0, 1, 1, 1])
      assert.equal(result.pass_rate, 0.75)
      assert.equal(result.observed_tier, 1)
      assert.equal(result.layers['baseline-benign'].passed, false)
      assert.equal(result.layers['bundle-probe'].passed, true)
      assert.equal(result.layers['bundle-probe'].detected_vuln, true)
      assert.equal(result.layers['bundle-probe'].detected_patched, false)
    },
  )

  test(
    'traversal-file-download (SILVER seed) panels [0,1,1,1] at tier 1',
    { skip: pythonAvailable ? false : `no python interpreter (${python})`, timeout: 120_000 },
    async () => {
      const snapshotDir = defaultSnapshotDir()
      const spec = loadSpec(snapshotDir, 'traversal-file-download')
      const result = await panelRun(bundleDir(snapshotDir, 'traversal-file-download'), spec, python)
      // The extended layer's pre-encoded payloads (..%2f, %2e%2e%2f) must
      // reach the app as authored; double-encoding them loses this layer.
      assert.deepEqual(result.vector, [0, 1, 1, 1])
      assert.equal(result.pass_rate, 0.75)
      assert.equal(result.observed_tier, 1)
    },
  )
})
