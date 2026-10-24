import { bundleDir, loadSpec, verifyBundle } from './loader.js'
import { panelRun } from './panel.js'
import { resolvePython } from './runner.js'
import { computeFitness } from './scoring.js'
import type { BundleGateReport, ManifestEntry, RunOptions } from './types.js'

/**
 * Run the full gate for one bundle: verify its hash against the manifest,
 * run the reference panel, and score it. A hash mismatch fails the gate
 * without booting the bundle.
 *
 * @param snapshotDir - the snapshot directory
 * @param entry - the bundle's manifest entry
 * @param options - python command overrides
 * @returns the bundle's gate report
 */
export async function runBundleGate(
  snapshotDir: string,
  entry: ManifestEntry,
  options: RunOptions = {},
): Promise<BundleGateReport> {
  const base: BundleGateReport = {
    slug: entry.slug,
    loop_tier: entry.loop_tier,
    vuln_class: entry.vuln_class,
    assigned_tier: entry.tier,
    hash_ok: false,
    panel: null,
    score: null,
    foundry_fitness: entry.fitness.fitness,
    foundry_pass_rate: entry.panel.pass_rate,
    error: null,
  }
  const verification = verifyBundle(snapshotDir, entry)
  if (!verification.ok) {
    return { ...base, error: `bundle hash mismatch: expected ${verification.expected}, got ${verification.actual}` }
  }
  base.hash_ok = true
  try {
    const spec = loadSpec(snapshotDir, entry.slug)
    const panel = await panelRun(bundleDir(snapshotDir, entry.slug), spec, resolvePython(options.python))
    const score = computeFitness({
      passRate: panel.pass_rate,
      tier: entry.tier,
      issued: entry.fitness.components,
      gatePass: panel.layers['bundle-probe'].passed,
    })
    return { ...base, panel, score }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Run the gate for a list of bundles, in order.
 *
 * @param snapshotDir - the snapshot directory
 * @param entries - the manifest entries to run
 * @param options - python command overrides
 * @param onResult - optional callback invoked with each report as it lands
 * @returns the gate reports, in entry order
 */
export async function runGate(
  snapshotDir: string,
  entries: ManifestEntry[],
  options: RunOptions = {},
  onResult?: (report: BundleGateReport) => void,
): Promise<BundleGateReport[]> {
  const reports: BundleGateReport[] = []
  for (const entry of entries) {
    const report = await runBundleGate(snapshotDir, entry, options)
    reports.push(report)
    onResult?.(report)
  }
  return reports
}
