/**
 * Gold Loop bundle evolution: mutate the highest-fitness GOLD snapshot
 * bundles into the store's own snapshot and validate them through the
 * foundry-gate runner.
 *
 * Per seed: operators rotate per cycle (reskin is case-level only) until
 * one builds; the mutant is written under <store>/snapshot/bundles/<slug>,
 * every generated Python file must pass the syntax gate, the store
 * manifest gains an entry whose bundle hash is recomputed from the
 * mutant's bytes, and the gate run decides survival — its panel carries
 * the positive (marker fires on the vulnerable twin) and negative
 * (silent on the patched twin) controls. Survivors register as SILVER
 * with lineage; failures are removed from disk and manifest alike.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSnapshot, type FoundryLocation } from './locate.js'
import { runGateCli } from './gate.js'
import { applyBundleOperator, bundleHashOfFiles, type BundleFiles } from './bundle-mutate.js'
import { OPERATORS, type Operator } from './mutate.js'
import { atomicWriteFile, loadRegistry, type RegistryEntry } from './store.js'
import type { BundleMutantOutcome } from './loop-state.js'

type Rec = Record<string, unknown>

interface StoreManifest {
  snapshot: string
  generated_at: string
  source: Rec
  bundles: Rec[]
}

function readBundleFiles(bundleDir: string): BundleFiles | null {
  const files: BundleFiles = new Map()
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Bytecode residue is never bundle content (the hash walks files).
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (entry.isFile()) files.set(rel, readFileSync(join(dir, entry.name), 'utf8'))
    }
  }
  try {
    walk(bundleDir, '')
  } catch {
    return null
  }
  return files
}

function writeBundleFiles(bundleDir: string, files: BundleFiles): void {
  for (const [rel, content] of files) {
    const path = join(bundleDir, ...rel.split('/'))
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }
}

/**
 * Syntax-check Python source in a scratch directory. Compiling inside the
 * bundle directory would leave __pycache__ bytecode behind, and the gate's
 * bundle hash walks every file — the check must never pollute the bundle.
 */
function pySyntaxCheck(python: string, files: BundleFiles): Promise<boolean> {
  const scratch = join(storeScratchDir(), `syntax-${process.pid}-${Date.now().toString(36)}`)
  return new Promise<boolean>((resolve) => {
    try {
      mkdirSync(scratch, { recursive: true })
      const pyFiles: string[] = []
      for (const [rel, content] of files) {
        if (!rel.endsWith('.py')) continue
        const path = join(scratch, rel.replace(/\//g, '_'))
        writeFileSync(path, content)
        pyFiles.push(path)
      }
      if (pyFiles.length === 0) {
        resolve(true)
        return
      }
      const child = spawn(python, ['-m', 'py_compile', ...pyFiles], { windowsHide: true })
      child.on('error', () => resolve(false))
      child.on('close', code => resolve(code === 0))
    } catch {
      resolve(false)
    }
  }).finally(() => {
    try {
      rmSync(scratch, { recursive: true, force: true })
    } catch {
      /* scratch cleanup is best-effort */
    }
  })
}

function storeScratchDir(): string {
  return join(tmpdir(), 'foundry-loop')
}

function loadStoreManifest(storeSnapshotDir: string): StoreManifest {
  const path = join(storeSnapshotDir, 'manifest.json')
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as StoreManifest
    if (raw && Array.isArray(raw.bundles)) return raw
  } catch {
    /* created below */
  }
  return {
    snapshot: 'foundry-store-loop',
    generated_at: new Date().toISOString(),
    source: { datasets: 0, gold: 0, silver: 0, live_cases: 0 },
    bundles: [],
  }
}

function saveStoreManifest(storeSnapshotDir: string, manifest: StoreManifest): void {
  atomicWriteFile(join(storeSnapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

function appendRegistryEntry(storeDir: string, entry: RegistryEntry): boolean {
  const registry = loadRegistry(storeDir)
  if (registry.entries.some(e => e.id === entry.id)) return false
  registry.entries.push(entry)
  atomicWriteFile(join(storeDir, 'registry.json'), JSON.stringify(registry, null, 2) + '\n')
  return true
}

const OPERATOR_CODES: Record<Operator, string> = {
  'marker-rotate': 'mr',
  'rename-param': 'rp',
  'rename-route': 'rr',
  'reskin': 'rs',
  'naive-filter': 'nf',
}

/** The outcome of the bundle-evolution step of one cycle. */
export interface BundleEvolutionResult {
  outcomes: BundleMutantOutcome[]
  generated: number
  survivors: number
}

/**
 * Run bundle evolution for one cycle.
 *
 * @param storeDir - the foundry store directory
 * @param location - the located snapshot + gate CLI
 * @param cycle - the cycle number (operator rotation + slug suffix)
 * @param at - the cycle timestamp
 * @param python - the Python command for the syntax gate
 * @returns per-seed outcomes and counts; never throws
 */
export async function runBundleEvolution(
  storeDir: string,
  location: FoundryLocation,
  cycle: number,
  at: string,
  python: string,
): Promise<BundleEvolutionResult> {
  const outcomes: BundleMutantOutcome[] = []
  let generated = 0
  let survivors = 0
  const snapshotDir = location.snapshotDir
  const gateCliPath = location.gateCliPath
  if (!snapshotDir || !gateCliPath) return { outcomes, generated, survivors }
  const snapshot = readSnapshot(snapshotDir)
  const goldSeeds = (snapshot?.bundles ?? [])
    .filter(b => b.loopTier === 'GOLD')
    .sort((a, b) => (b.fitness ?? -1) - (a.fitness ?? -1))
    .slice(0, 2)
  const storeSnapshotDir = join(storeDir, 'snapshot')
  mkdirSync(join(storeSnapshotDir, 'bundles'), { recursive: true })
  const manifest = loadStoreManifest(storeSnapshotDir)
  const seedManifest = JSON.parse(readFileSync(join(snapshotDir, 'manifest.json'), 'utf8')) as StoreManifest

  for (const [seedIndex, seed] of goldSeeds.entries()) {
    const seedFiles = readBundleFiles(join(snapshotDir, 'bundles', seed.slug))
    if (!seedFiles) {
      outcomes.push({ seedSlug: seed.slug, operator: '-', slug: null, ok: false, detail: 'seed bundle files unreadable', gatePass: null, fitness: null })
      continue
    }
    let built: { operator: Operator; files: BundleFiles; detail: string } | null = null
    let lastError = ''
    for (let step = 0; step < OPERATORS.length; step++) {
      const operator = OPERATORS[(cycle - 1 + seedIndex + step) % OPERATORS.length]
      if (operator === undefined || operator === 'reskin') continue
      const outcome = applyBundleOperator(seedFiles, operator, seed.slug, cycle)
      if (outcome.ok) {
        built = { operator, files: outcome.value.files, detail: outcome.value.detail }
        break
      }
      lastError = `${operator}: ${outcome.error}`
    }
    if (!built) {
      outcomes.push({ seedSlug: seed.slug, operator: '-', slug: null, ok: false, detail: `no operator built a mutant (${lastError})`, gatePass: null, fitness: null })
      continue
    }
    generated++
    const slug = `${seed.slug}-g${cycle}${OPERATOR_CODES[built.operator]}`
    // The mutant's spec carries its own slug and its lineage block (the
    // reference records lineage in spec.json as well as in the registry).
    try {
      const specText = built.files.get('spec.json')
      if (specText === undefined) throw new Error('mutant has no spec.json')
      const spec = JSON.parse(specText) as Rec
      spec['slug'] = slug
      spec['lineage'] = { seed: seed.slug, operator: built.operator, cycle }
      built.files.set('spec.json', JSON.stringify(spec, null, 2) + '\n')
    } catch {
      outcomes.push({ seedSlug: seed.slug, operator: built.operator, slug, ok: false, detail: 'spec.json restamp failed; mutant not written', gatePass: null, fitness: null })
      continue
    }
    if (manifest.bundles.some(b => b['slug'] === slug)) {
      outcomes.push({ seedSlug: seed.slug, operator: built.operator, slug, ok: true, detail: 'already in the store snapshot (idempotent)', gatePass: null, fitness: null })
      continue
    }
    const mutantDir = join(storeSnapshotDir, 'bundles', slug)
    // Syntax gate (the reference's defect lesson): every generated Python
    // file must parse before the mutant is accepted — checked on the file
    // contents in a scratch dir, before anything is written.
    if (!(await pySyntaxCheck(python, built.files))) {
      outcomes.push({ seedSlug: seed.slug, operator: built.operator, slug, ok: false, detail: 'syntax gate failed; mutant not written', gatePass: null, fitness: null })
      continue
    }
    writeBundleFiles(mutantDir, built.files)
    const seedEntry = seedManifest.bundles.find(b => b['slug'] === seed.slug) ?? {}
    const bundleHash = bundleHashOfFiles(built.files)
    const entry: Rec = {
      ...seedEntry,
      slug,
      loop_tier: 'SILVER',
      status: 'generated',
      bundle_hash: bundleHash,
      lineage: { seed: seed.slug, operator: built.operator, cycle },
    }
    manifest.bundles.push(entry)
    saveStoreManifest(storeSnapshotDir, manifest)

    // Validate through the gate runner: the panel's positive/negative
    // controls run inside it; the --out report is the receipt.
    const outPath = join(storeDir, `.loop-gate-${slug}.json`)
    const gate = await runGateCli(
      gateCliPath,
      ['run', '--slug', slug, '--snapshot', storeSnapshotDir, '--out', outPath],
      300_000,
    )
    let gatePass: boolean | null = null
    let gateFitness: number | null = null
    let gateDetail = ''
    try {
      const report = JSON.parse(readFileSync(outPath, 'utf8')) as { results?: Rec[] }
      const first = report.results?.[0]
      if (first && typeof first === 'object') {
        const score = first['score'] as Rec | null
        const panel = first['panel'] as Rec | null
        gatePass = score ? (score['gate_pass'] as boolean) : null
        gateFitness = score ? (score['fitness'] as number) : null
        gateDetail = panel
          ? `panel vector ${JSON.stringify(panel['vector'])} pass ${(panel['pass_rate'] as number)?.toFixed?.(2) ?? panel['pass_rate']}`
          : `error: ${String(first['error'] ?? 'no panel result')}`
      }
    } catch {
      gateDetail = `gate report unreadable (exit ${gate.exitCode})`
    }
    rmSync(outPath, { force: true })
    if (gatePass === true) {
      entry['status'] = 'validated'
      saveStoreManifest(storeSnapshotDir, manifest)
      const registered = appendRegistryEntry(storeDir, {
        id: slug,
        kind: 'bundle',
        origin: 'loop-mutant',
        family: seed.family,
        tier: 'SILVER',
        sourceEngagementId: null,
        createdAt: at,
        contentHash: bundleHash,
        lineage: { seedSlug: seed.slug, operator: built.operator, cycle },
      })
      if (registered) survivors++
      outcomes.push({
        seedSlug: seed.slug, operator: built.operator, slug, ok: true,
        detail: `${built.detail}; ${gateDetail}`, gatePass, fitness: gateFitness,
      })
    } else {
      manifest.bundles = manifest.bundles.filter(b => b['slug'] !== slug)
      saveStoreManifest(storeSnapshotDir, manifest)
      rmSync(mutantDir, { recursive: true, force: true })
      outcomes.push({
        seedSlug: seed.slug, operator: built.operator, slug, ok: false,
        detail: `gate rejected the mutant (${gateDetail || `exit ${gate.exitCode}`}); removed`, gatePass, fitness: gateFitness,
      })
    }
  }
  return { outcomes, generated, survivors }
}
