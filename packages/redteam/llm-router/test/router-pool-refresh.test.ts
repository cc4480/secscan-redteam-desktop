/**
 * Router-level pool refresh: pools built at module load start empty in
 * a scrubbed environment; once the host installs the store-backed
 * resolver (setFleetConfigResolver — what the runner's cli.ts does at
 * startup), poolSnapshots() reconciles each pool with the resolver's
 * CURRENT answers. A key seated after boot appears; a rotated key
 * replaces the dead one; an unseated key empties the pool. No restart,
 * no re-import.
 */

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setFleetConfigResolver } from '../src/resolver.js'

const KEY_REFS = [
  'DEEPSEEK_API_KEY', 'MODEL_API_KEY', 'META_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'ZAI_API_KEY', 'GEMINI_API_KEY',
  'REDTEAM_LLM_PROVIDER',
]

test('poolSnapshots() tracks keys seated, rotated, and removed through the resolver', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'router-pool-refresh-'))
  const saved = new Map<string, string | undefined>()
  for (const name of [...KEY_REFS, 'REDTEAM_LLM_POOL_STATE_FILE']) {
    saved.set(name, process.env[name])
    delete process.env[name]
  }
  process.env['REDTEAM_LLM_POOL_STATE_FILE'] = join(dir, 'state.json')

  // The store the fake resolver reads: mutated by the test to play the
  // operator seating, rotating, and removing keys in the app.
  const store = new Map<string, string>()
  setFleetConfigResolver({ valueFor: (name: string) => store.get(name) })
  try {
    const router = await import('../src/router.js')
    const deepseekEntries = () =>
      router.poolSnapshots().find(s => s.providerId === 'deepseek')?.entries ?? []

    assert.equal(deepseekEntries().length, 0, 'no key seated anywhere: the pool is empty')

    store.set('DEEPSEEK_API_KEY', 'seated-after-boot')
    assert.equal(deepseekEntries().length, 1, 'a key seated after boot reaches the pool')
    assert.equal(deepseekEntries()[0]?.dead, false)

    store.set('DEEPSEEK_API_KEY', 'rotated-key')
    const rotated = deepseekEntries()
    assert.equal(rotated.length, 1, 'rotation keeps exactly one entry')
    assert.equal(rotated[0]?.dead, false)

    store.delete('DEEPSEEK_API_KEY')
    assert.equal(deepseekEntries().length, 0, 'removing the key empties the pool')

    // Every keyed provider answers the same way through its own ref.
    store.set('ANTHROPIC_API_KEY', 'claude-key')
    const anthropic = router.poolSnapshots().find(s => s.providerId === 'anthropic')
    assert.equal(anthropic?.entries.length, 1)
    assert.equal(anthropic?.entries[0]?.dead, false)
  } finally {
    setFleetConfigResolver(undefined)
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
