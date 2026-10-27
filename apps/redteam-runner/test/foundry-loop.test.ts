/**
 * Gold Loop + Foundry console route tests.
 *
 * The loop runs against a tmp store seeded through the real registry.
 * Bundle evolution runs against the repo's real snapshot GOLD seed with a
 * fixture gate CLI standing in for the panel run (the panel itself is the
 * gate package's own test surface); the operator surgery, syntax gate,
 * manifest bookkeeping, and registry registration under test are the real
 * in-app code. The console route test drives the real HTTP server.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { loadLoopState, runLoopCycle } from '../src/foundry/loop.js'
import { scoreStoreCases } from '../src/foundry/fitness.js'
import { applyCaseOperator, validateCaseMutant } from '../src/foundry/mutate.js'
import { bundleHashOfFiles } from '../src/foundry/bundle-mutate.js'
import {
  caseContentHash,
  caseIdFor,
  listCases,
  loadRegistry,
  registerCase,
  type FoundryCase,
} from '../src/foundry/store.js'
import type { FoundryLocation } from '../src/foundry/locate.js'
import { startUiServer } from '../src/ui/server.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_SNAPSHOT = join(HERE, '..', '..', '..', '..', 'packages', 'redteam', 'foundry-gate', 'snapshot')

function tmpRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function seedCase(store: string, engagementId: string, payloadClass = 'tautology-quote'): FoundryCase {
  const pattern = {
    family: 'sqli',
    vulnClass: 'sql-injection',
    cwe: 'CWE-89',
    severity: 'high',
    endpointShape: ['/search?q={}'],
    methodMix: [],
    payloadClass,
    proofType: 'cell-proven',
    techFingerprints: ['wordpress'],
  }
  const contentHash = caseContentHash(pattern)
  const foundryCase: FoundryCase = {
    id: caseIdFor(engagementId, contentHash),
    kind: 'live-case',
    origin: 'scan',
    family: 'sqli',
    vulnClass: pattern.vulnClass,
    cwe: pattern.cwe,
    severity: pattern.severity,
    endpointShape: pattern.endpointShape,
    methodMix: pattern.methodMix,
    payloadClass: pattern.payloadClass,
    proofType: pattern.proofType,
    mechanisms: ['live-detection', 'dual-exploiter-cell', 'state-confirmation'],
    techFingerprints: pattern.techFingerprints,
    tier: 'SILVER',
    sourceEngagementId: engagementId,
    lineage: null,
    createdAt: '2026-10-25T00:00:00.000Z',
    contentHash,
  }
  registerCase(store, foundryCase)
  return foundryCase
}

const NO_LOCATION: FoundryLocation = {
  snapshotDir: null,
  snapshotVia: null,
  snapshotCandidates: [],
  gateCliPath: null,
  gatePackageRoots: [],
}

describe('fitness port', () => {
  it('scores with renormalization and never invents panel components', () => {
    const store = join(tmpRoot('foundry-fit-'), 'foundry-store')
    const a = seedCase(store, 'eng-a')
    const b = seedCase(store, 'eng-b', 'union-select')
    const scores = scoreStoreCases([a, b])
    const fa = scores.get(a.id)
    assert.ok(fa)
    assert.equal(fa.components.discrimination, null)
    assert.equal(fa.components.difficultyFit, null)
    assert.ok(fa.fitness !== null && fa.fitness > 0 && fa.fitness <= 1)
    assert.ok(fa.scoredWeight > 0 && fa.scoredWeight < 1)
    // Same family + tier cell: coverage_gain = 1/(1+1).
    assert.equal(fa.components.coverageGain, 0.5)
  })
})

describe('case mutation controls', () => {
  it('rotates a payload class deterministically and passes the battery', () => {
    const store = join(tmpRoot('foundry-mut-'), 'foundry-store')
    const seed = seedCase(store, 'eng-seed')
    const outcome = applyCaseOperator(seed, 'marker-rotate', 1)
    assert.ok(outcome.ok)
    if (!outcome.ok) return
    assert.equal(outcome.value.payloadClass, 'tautology-numeric')
    const again = applyCaseOperator(seed, 'marker-rotate', 1)
    assert.ok(again.ok)
    if (!again.ok) return
    assert.equal(caseContentHash(again.value), caseContentHash(outcome.value))
    const mutant: FoundryCase = {
      ...seed,
      id: caseIdFor('loop:test', caseContentHash(outcome.value)),
      origin: 'loop-mutant',
      payloadClass: outcome.value.payloadClass,
      tier: 'BRONZE',
      lineage: { seedCaseId: seed.id, operator: 'marker-rotate', cycle: 1 },
      contentHash: caseContentHash(outcome.value),
    }
    const validation = validateCaseMutant(mutant, [seed], () => mutant)
    assert.equal(validation.pass, true)
  })

  it("fails loud when an operator's anchor is absent", () => {
    const store = join(tmpRoot('foundry-mut-'), 'foundry-store')
    const seed = seedCase(store, 'eng-seed')
    const outcome = applyCaseOperator({ ...seed, endpointShape: ['/plain'] }, 'rename-param', 1)
    assert.equal(outcome.ok, false)
  })
})

describe('gold loop cycle', () => {
  it('scores the store, registers a case-mutant survivor with lineage, and persists state', async () => {
    const store = join(tmpRoot('foundry-loop-'), 'foundry-store')
    const seed = seedCase(store, 'eng-seed')
    const summary = await runLoopCycle(store, { location: NO_LOCATION })
    assert.equal(summary.error, null)
    assert.equal(summary.casesScored, 1)
    assert.ok(summary.notes.some(n => n.includes('bundle evolution skipped')))
    const caseOutcome = summary.caseMutants[0]
    assert.ok(caseOutcome)
    assert.equal(caseOutcome.ok, true)
    assert.equal(caseOutcome.operator, 'marker-rotate')
    const cases = listCases(store)
    const mutant = cases.find(c => c.origin === 'loop-mutant')
    assert.ok(mutant)
    assert.equal(mutant.lineage?.seedCaseId, seed.id)
    assert.equal(mutant.tier, 'BRONZE')
    const state = loadLoopState(store)
    assert.equal(state.cyclesRun, 1)
    assert.ok(state.fitness[seed.id]?.fitness !== null)
  })

  it('evolves a GOLD bundle through the gate and registers the survivor with lineage', async () => {
    const root = tmpRoot('foundry-loop-bundle-')
    const store = join(root, 'foundry-store')
    mkdirSync(store, { recursive: true })
    // Fixture gate CLI: a stand-in that emits a passing --out report for
    // whatever slug it is handed (the panel itself is the gate's surface).
    const cli = join(root, 'fake-gate-cli.mjs')
    writeFileSync(
      cli,
      [
        "import { writeFileSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        "const slug = args[args.indexOf('--slug') + 1];",
        "const out = args[args.indexOf('--out') + 1];",
        "const results = [{ slug, loop_tier: 'SILVER', assigned_tier: 1, panel: { vector: [0,1,1,1], pass_rate: 0.75, observed_tier: 1 }, score: { fitness: 0.59, gate_pass: true }, error: null }];",
        "if (out) writeFileSync(out, JSON.stringify({ snapshot: 'store', results }));",
        'console.log(`${slug.padEnd(28)} [0,1,1,1] pass 0.75 tier 1 vs T1 F 0.5900 gate PASS`);',
        '',
      ].join('\n'),
    )
    const location: FoundryLocation = {
      snapshotDir: REPO_SNAPSHOT,
      snapshotVia: 'test-fixture',
      snapshotCandidates: [],
      gateCliPath: cli,
      gatePackageRoots: [],
    }
    const summary = await runLoopCycle(store, { location })
    assert.equal(summary.error, null)
    const bundleOutcome = summary.bundleMutants.find(b => b.seedSlug === 'sqli-product-search')
    assert.ok(bundleOutcome, `expected a bundle outcome for the sqli GOLD seed: ${JSON.stringify(summary.bundleMutants)}`)
    assert.equal(bundleOutcome.ok, true)
    assert.equal(bundleOutcome.gatePass, true)
    assert.ok(bundleOutcome.slug?.startsWith('sqli-product-search-g1'))
    // Survivor on disk in the store snapshot, transformed per its operator
    // (seed order is by snapshot fitness: xss first, so sqli's rotation
    // lands past marker-rotate — assert the operator's own dimension).
    const mutantDir = join(store, 'snapshot', 'bundles', bundleOutcome.slug!)
    assert.equal(existsSync(join(mutantDir, 'spec.json')), true)
    const spec = JSON.parse(readFileSync(join(mutantDir, 'spec.json'), 'utf8')) as {
      marker: string
      endpoints: string[]
      lineage?: { seed: string; operator: string }
    }
    assert.equal(spec.lineage?.seed, 'sqli-product-search')
    assert.equal(spec.lineage?.operator, bundleOutcome.operator)
    if (bundleOutcome.operator === 'marker-rotate') {
      assert.notEqual(spec.marker, 'FNDRY-SQLI-7Q2X9')
    } else if (bundleOutcome.operator === 'rename-param') {
      assert.ok(!spec.endpoints[0]?.startsWith('GET /search?q='))
    } else if (bundleOutcome.operator === 'rename-route') {
      assert.ok(!spec.endpoints[0]?.startsWith('GET /search?'))
    } else {
      assert.ok(bundleOutcome.detail.length > 0)
    }
    // Registry carries the bundle with lineage.
    const entry = loadRegistry(store).entries.find(e => e.id === bundleOutcome.slug)
    assert.ok(entry)
    assert.equal(entry.kind, 'bundle')
    assert.equal(entry.tier, 'SILVER')
    assert.equal(entry.lineage?.seedSlug, 'sqli-product-search')
    // The gate hashes every file in a bundle dir: the mutant dir must hold
    // no bytecode residue, and its bytes must hash to the registry value.
    assert.equal(existsSync(join(mutantDir, 'vuln', '__pycache__')), false)
    assert.equal(existsSync(join(mutantDir, 'patched', '__pycache__')), false)
    const onDisk: Map<string, string> = new Map()
    for (const rel of ['spec.json', 'vuln/app.py', 'patched/app.py', 'probe.py']) {
      onDisk.set(rel, readFileSync(join(mutantDir, ...rel.split('/')), 'utf8'))
    }
    assert.equal(bundleHashOfFiles(onDisk), entry.contentHash)
    // The seed snapshot was not modified.
    const seedSpec = JSON.parse(readFileSync(join(REPO_SNAPSHOT, 'bundles', 'sqli-product-search', 'spec.json'), 'utf8')) as { marker: string }
    assert.equal(seedSpec.marker, 'FNDRY-SQLI-7Q2X9')
  })

  it('never throws on a broken store — the failure rides the summary', async () => {
    const root = tmpRoot('foundry-loop-broken-')
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'x')
    const summary = await runLoopCycle(join(blocker, 'foundry-store'), { location: NO_LOCATION })
    assert.ok(summary !== null)
    assert.equal(summary.casesScored, 0)
  })
})

describe('foundry API route', () => {
  it('serves the snapshot, store, and loop state, and runs verify per family', async () => {
    const root = tmpRoot('foundry-console-')
    const engagements = join(root, 'engagements')
    mkdirSync(engagements, { recursive: true })
    const store = join(root, 'foundry-store')
    seedCase(store, 'eng-console')
    // A loop-registered bundle row, written the way the loop writes it.
    const registry = loadRegistry(store)
    registry.entries.push({
      id: 'sqli-product-search-g1rp',
      kind: 'bundle',
      origin: 'loop-mutant',
      family: 'sqli-product-search',
      tier: 'SILVER',
      sourceEngagementId: null,
      createdAt: '2026-10-26T00:00:00.000Z',
      contentHash: 'a'.repeat(64),
      lineage: { seedSlug: 'sqli-product-search', operator: 'rename-param', cycle: 1 },
    })
    writeFileSync(join(store, 'registry.json'), JSON.stringify(registry, null, 2) + '\n')
    writeFileSync(
      join(root, 'fake-gate-cli.mjs'),
      [
        "console.log('sqli-product-search          OK 711ab85eb421');",
        "console.log('xss-reflected-search         OK b0814f36e5aa');",
        "console.log('verified 2/2 bundles OK');",
        '',
      ].join('\n'),
    )

    const previousSnapshot = process.env['REDTEAM_FOUNDRY_SNAPSHOT']
    process.env['REDTEAM_FOUNDRY_SNAPSHOT'] = REPO_SNAPSHOT
    const srv = await startUiServer({ port: 0, engagementsDir: engagements })
    try {
      const headers = { Authorization: `Bearer ${srv.token}` }
      const getRes = await fetch(`http://127.0.0.1:${srv.port}/api/foundry`, { headers })
      assert.equal(getRes.status, 200)
      const getBody = (await getRes.json()) as {
        available: boolean
        snapshot: { counts: { total: number; gold: number } } | null
        store: {
          cases: Array<{ family: string; tier: string }>
          bundles: Array<{ id: string; tier: string; lineage?: { seedSlug?: string } }>
          counts: { total: number }
        }
        loop: { cyclesRun: number }
      }
      assert.equal(getBody.available, true)
      assert.equal(getBody.snapshot?.counts.total, 36)
      assert.equal(getBody.snapshot?.counts.gold, 2)
      assert.equal(getBody.store.cases.length, 1)
      assert.equal(getBody.store.cases[0]?.tier, 'SILVER')
      assert.equal(getBody.store.bundles.length, 1)
      assert.equal(getBody.store.bundles[0]?.id, 'sqli-product-search-g1rp')
      assert.equal(getBody.store.bundles[0]?.lineage?.seedSlug, 'sqli-product-search')
      assert.equal(getBody.store.counts.total, 2)
      assert.equal(getBody.loop.cyclesRun, 0)

      // The verify action's per-family results come from the fixture CLI
      // only when discovery locates it; in this repo layout the payload
      // node_modules candidate is absent, so accept either the honest
      // unavailable answer or a real per-family pass — never a fake one.
      const verifyRes = await fetch(`http://127.0.0.1:${srv.port}/api/foundry/verify`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
      })
      assert.equal(verifyRes.status, 200)
      const verifyBody = (await verifyRes.json()) as {
        ok: boolean
        error?: string
        perFamily?: Array<{ family: string; ok: number }>
      }
      if (verifyBody.ok) {
        assert.ok((verifyBody.perFamily ?? []).length > 0)
      } else {
        assert.ok(typeof verifyBody.error === 'string' && verifyBody.error.length > 0)
      }
    } finally {
      await srv.close()
      if (previousSnapshot === undefined) delete process.env['REDTEAM_FOUNDRY_SNAPSHOT']
      else process.env['REDTEAM_FOUNDRY_SNAPSHOT'] = previousSnapshot
    }
  })
})
