/**
 * The tool-layer authorization gate must fire on the real scan tool,
 * `secscan_exec`, whose active tier is `depth === 'deep'` and whose target is
 * the `url` argument (apps/redteam-runner/src/dispatch/secscan.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decide } from '@secscan/redteam-auth-gate'

const allow = { isVerified: async () => true }
const deny = { isVerified: async () => false }

test('active secscan_exec on unverified domain is denied', async () => {
  const d = await decide({ toolName: 'secscan_exec', arguments: { url: 'https://acme.example', depth: 'deep' } }, deny)
  assert.equal(d.kind, 'deny')
})

test('active secscan_exec on verified domain is allowed (engine still enforces its own deep-tier proof)', async () => {
  const d = await decide({ toolName: 'secscan_exec', arguments: { url: 'https://acme.example', depth: 'deep' } }, allow)
  assert.equal(d.kind, 'allow')
})

test('passive secscan_exec is allowed regardless', async () => {
  const d = await decide({ toolName: 'secscan_exec', arguments: { url: 'https://acme.example', depth: 'passive' } }, deny)
  assert.equal(d.kind, 'allow')
})

test('active secscan_exec with no parseable url is denied cleanly', async () => {
  const d = await decide({ toolName: 'secscan_exec', arguments: { depth: 'deep' } }, deny)
  assert.equal(d.kind, 'deny')
})

test('a passive-looking extra argument cannot downgrade depth=deep', async () => {
  const d = await decide(
    { toolName: 'secscan_exec', arguments: { url: 'https://acme.example', depth: 'deep', passive: true } },
    deny,
  )
  assert.equal(d.kind, 'deny')
})

test('the gate checks the url the engine scans, not a different parseable key', async () => {
  const seen: string[] = []
  const ctx = { isVerified: async (host: string) => { seen.push(host); return host === 'verified.example' } }
  const d = await decide(
    { toolName: 'secscan_exec', arguments: { url: 'not a url', target: 'https://verified.example', depth: 'deep' } },
    ctx,
  )
  assert.equal(d.kind, 'deny')
  assert.deepEqual(seen, [])
})
