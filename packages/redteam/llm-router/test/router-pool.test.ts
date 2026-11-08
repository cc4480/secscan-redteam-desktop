/**
 * Router pool wiring: the built-in providers' pools are built once at
 * module load with the shared state store attached, are visible through
 * poolSnapshots(), and mere construction performs no file writes (restore
 * reads; only state-changing mutations save).
 *
 * The environment is set BEFORE the router module is imported (dynamic
 * import inside the test), because the wiring resolves at module load.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('pools are built with the shared store and visible via poolSnapshots(); construction writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'router-pool-'))
  const stateFile = join(dir, 'state.json')
  process.env['REDTEAM_LLM_POOL_STATE_FILE'] = stateFile
  process.env['DEEPSEEK_API_KEY'] = 'router-test-key'
  try {
    const router = await import('../src/router.js')
    const snapshots = router.poolSnapshots()
    assert.deepEqual(
      snapshots.map(snap => snap.providerId),
      ['deepseek', 'qwen', 'meta', 'openai', 'anthropic', 'xai', 'zai', 'gemini'],
      'every keyed provider has a live pool; the keyless local provider has none',
    )
    const deepseek = snapshots[0]
    assert.equal(deepseek?.entries.length, 1)
    assert.equal(
      deepseek?.entries[0]?.fingerprint,
      createHash('sha256').update('router-test-key', 'utf8').digest('hex').slice(0, 8),
    )
    assert.equal(deepseek?.entries[0]?.dead, false)
    assert.equal(existsSync(stateFile), false, 'construction alone creates no state file')
  } finally {
    delete process.env['REDTEAM_LLM_POOL_STATE_FILE']
    delete process.env['DEEPSEEK_API_KEY']
  }
})
