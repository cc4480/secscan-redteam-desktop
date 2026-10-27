/**
 * Foundry location + gate output parsing tests.
 *
 * Discovery runs against fixture directory trees under a tmp dir — no repo
 * paths are trusted: a fake payload root proves the candidate order (env,
 * sibling, gate package) and the honest not-found result.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  locateFoundry,
  readSnapshot,
} from '../src/foundry/locate.js'
import {
  parseRunOutput,
  parseVerifyOutput,
  runGateCli,
} from '../src/foundry/gate.js'

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'foundry-locate-'))
}

function writeSnapshot(dir: string, bundles: unknown[]): void {
  mkdirSync(join(dir, 'bundles'), { recursive: true })
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      snapshot: 'fixture-snapshot',
      generated_at: '2026-10-25T00:00:00Z',
      source: { datasets: bundles.length, gold: 1, silver: 1, live_cases: 0 },
      bundles,
    }),
  )
}

const FIXTURE_BUNDLES = [
  {
    slug: 'sqli-product-search', family_id: 'sqli-product-search', loop_tier: 'GOLD',
    vuln_class: 'sql-injection', cwe: 'CWE-89', tier: 1, status: 'validated',
    bundle_hash: 'a'.repeat(64), fitness: { fitness: 0.5864 }, panel: { pass_rate: 0.75 },
  },
  {
    slug: 'xss-reflected-search', family_id: 'xss-reflected-search', loop_tier: 'SILVER',
    vuln_class: 'cross-site-scripting', cwe: 'CWE-79', tier: 1, status: 'validated',
    bundle_hash: 'b'.repeat(64), fitness: { fitness: 0.5875 }, panel: { pass_rate: 0.75 },
  },
]

function writeGatePackage(root: string): string {
  const snapshotDir = join(root, 'snapshot')
  writeSnapshot(snapshotDir, FIXTURE_BUNDLES)
  mkdirSync(join(root, 'lib', 'types'), { recursive: true })
  const cli = join(root, 'lib', 'types', 'cli.js')
  writeFileSync(cli, '// fixture cli\n')
  return cli
}

describe('foundry discovery', () => {
  it('prefers the env-named snapshot over every other candidate', () => {
    const root = tmpRoot()
    const payload = join(root, 'payload')
    mkdirSync(payload, { recursive: true })
    writeGatePackage(join(payload, 'node_modules', '@secscan', 'redteam-foundry-gate'))
    const envSnap = join(root, 'env-snap')
    writeSnapshot(envSnap, FIXTURE_BUNDLES)
    const location = locateFoundry({ env: { REDTEAM_FOUNDRY_SNAPSHOT: envSnap }, payloadRoot: payload })
    assert.equal(location.snapshotDir, envSnap)
    assert.equal(location.snapshotVia, 'env:REDTEAM_FOUNDRY_SNAPSHOT')
    assert.ok(location.gateCliPath?.endsWith(join('lib', 'types', 'cli.js')))
  })

  it('finds the sibling foundry-snapshot next to the payload root', () => {
    const root = tmpRoot()
    const payload = join(root, 'payload')
    mkdirSync(payload, { recursive: true })
    const sibling = join(root, 'foundry-snapshot')
    writeSnapshot(sibling, FIXTURE_BUNDLES)
    const location = locateFoundry({ env: {}, payloadRoot: payload })
    assert.equal(location.snapshotDir, sibling)
    assert.equal(location.snapshotVia, 'sibling:foundry-snapshot')
  })

  it("finds the gate package's bundled snapshot in the payload node_modules", () => {
    const root = tmpRoot()
    const payload = join(root, 'payload')
    mkdirSync(payload, { recursive: true })
    writeGatePackage(join(payload, 'node_modules', '@secscan', 'redteam-foundry-gate'))
    const location = locateFoundry({ env: {}, payloadRoot: payload })
    assert.ok(location.snapshotDir?.includes('redteam-foundry-gate'))
    assert.ok(location.snapshotVia?.startsWith('gate-package:'))
  })

  it('reports every candidate when nothing is a valid snapshot', () => {
    const root = tmpRoot()
    const payload = join(root, 'payload')
    mkdirSync(payload, { recursive: true })
    // A directory that merely exists is not a snapshot.
    mkdirSync(join(root, 'foundry-snapshot'), { recursive: true })
    const location = locateFoundry({ env: {}, payloadRoot: payload })
    assert.equal(location.snapshotDir, null)
    assert.equal(location.gateCliPath, null)
    assert.ok(location.snapshotCandidates.length >= 3)
    assert.ok(location.snapshotCandidates.every(c => !c.valid))
  })

  it('projects the manifest with tiers and counts', () => {
    const root = tmpRoot()
    const snap = join(root, 'snap')
    writeSnapshot(snap, FIXTURE_BUNDLES)
    const info = readSnapshot(snap)
    assert.ok(info)
    assert.equal(info.name, 'fixture-snapshot')
    assert.equal(info.counts.total, 2)
    assert.equal(info.counts.gold, 1)
    assert.equal(info.counts.silver, 1)
    assert.equal(info.bundles[0]?.fitness, 0.5864)
    assert.equal(info.bundles[0]?.panelPassRate, 0.75)
  })
})

describe('gate output parsing', () => {
  it('parses verify rows and the summary line', () => {
    const parsed = parseVerifyOutput(
      'sqli-product-search          OK 711ab85eb421\n' +
        'xss-reflected-search         MISMATCH expected abc got def\n' +
        'verified 1/2 bundles OK\n',
    )
    assert.equal(parsed.rows.length, 2)
    assert.deepEqual(parsed.rows[0], { slug: 'sqli-product-search', ok: true })
    assert.deepEqual(parsed.rows[1], { slug: 'xss-reflected-search', ok: false })
    assert.equal(parsed.okCount, 1)
    assert.equal(parsed.totalCount, 2)
  })

  it('parses run panel rows and error rows', () => {
    const rows = parseRunOutput(
      'sqli-product-search          [0,1,1,1] pass 0.75 tier 1 vs T1 F 0.5864 gate PASS\n' +
        'ssrf-url-preview             ERROR boom\n',
    )
    assert.equal(rows.length, 2)
    assert.equal(rows[0]?.gatePass, true)
    assert.equal(rows[0]?.passRate, 0.75)
    assert.equal(rows[0]?.observedTier, 1)
    assert.equal(rows[1]?.error, 'boom')
    assert.equal(rows[1]?.gatePass, null)
  })

  it('runs a gate CLI with an argument array and captures its output', async () => {
    const root = tmpRoot()
    const cli = join(root, 'cli.mjs')
    writeFileSync(
      cli,
      "console.log('sqli-product-search          OK 711ab85eb421');\n" +
        "console.log('verified 1/1 bundles OK');\n",
    )
    const result = await runGateCli(cli, ['verify', '--snapshot', root], 30_000)
    assert.equal(result.exitCode, 0)
    assert.equal(result.spawnError, null)
    const parsed = parseVerifyOutput(result.stdout)
    assert.equal(parsed.okCount, 1)
    assert.equal(parsed.totalCount, 1)
  })

  it('times out a gate CLI that never exits', async () => {
    const root = tmpRoot()
    const cli = join(root, 'cli.mjs')
    writeFileSync(cli, 'setTimeout(() => {}, 60_000);\n')
    const result = await runGateCli(cli, ['verify'], 300)
    assert.equal(result.timedOut, true)
  })
})
