/**
 * Aggregate builders for the Windows lanes: the blocking pair, the complete
 * matrix, and the observational diagnostics.
 */
import { ciStaticGates } from './run-gates-aggregates.ts'
import { builtBinSmokeGate, builtPackageInvariantsGate, ciBuildGate, coverageGates, pnpmScript } from './run-gates-leaves.ts'
import type { Gate } from './run-gates-types.ts'

/**
 * Build the Windows blocking aggregate.
 * @returns the blocking Windows gates.
 */
export function ciWindowsBlockingGates(): Gate[] {
  return [
    ciBuildGate('windows-build', { label: 'build' }),
    pnpmScript('windows-site', 'docs:build', { label: 'production site' }),
  ]
}

/**
 * Build the complete Windows aggregate: the required lanes plus every
 * observational diagnostic.
 * @returns the complete Windows gates.
 */
export function ciWindowsCompleteGates(): Gate[] {
  const coverage = coverageGates().map(gate => ({
    ...gate,
    needs: [...new Set(['build', ...(gate.needs ?? [])])],
  }))
  const coverageAfter = coverage.map(gate => gate.id)
  const observational = ciWindowsObservationalGates()
    // The required production site replaces the observational MPA build; both
    // VitePress modes write the same output directory and cannot overlap.
    .filter(gate => gate.id !== 'build' && gate.id !== 'docs-site-build')
    .map(gate => ({
      ...gate,
      allowFailure: true,
      after: [...new Set([
        ...coverageAfter,
        ...(gate.after ?? []).map(id => id === 'docs-site-build' ? 'windows-site' : id),
      ])],
    }))
  return [
    ciBuildGate(),
    pnpmScript('windows-site', 'docs:build', { label: 'production site' }),
    ...coverage,
    ...observational,
  ]
}

/**
 * Build the Windows observational diagnostics, which never block the lane.
 * @returns the observational Windows gates.
 */
export function ciWindowsObservationalGates(): Gate[] {
  const predecessors = [
    ...ciStaticGates({ ownsBuild: true }),
    // Linux owns required lint and snapshots; Windows omits those duplicates.
    pnpmScript('duplication', 'duplication'),
    pnpmScript('publint', 'publint', { needs: ['build'] }),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      needs: ['build'],
    }),
    builtPackageInvariantsGate(['build']),
  ]
  return [
    ...predecessors,
    {
      ...builtBinSmokeGate(),
      // This smoke starts real application children with bounded startup
      // deadlines. Let other Windows processes settle before measuring startup.
      after: predecessors.map(gate => gate.id),
    },
  ]
}
