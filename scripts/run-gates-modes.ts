/**
 * Aggregate selection: the named mode to gate list mapping and the Node
 * compatibility aggregate.
 */
import { flagEnabled, runningNodeMajor } from './run-gates-environment.ts'
import {
  ciArtifactGates,
  ciConsumerGates,
  ciPrimaryGates,
  ciStaticGates,
  nodeCompatSmokeGates,
} from './run-gates-aggregates.ts'
import { docQuickLeafGates, docSyncLeafGates, hygieneLeafGates } from './run-gates-hygiene.ts'
import {
  ciBuildGate,
  coverageGates,
  expectedOutputGate,
  lintGate,
  pnpmScript,
  snapshotGate,
  webSnapshotGate,
} from './run-gates-leaves.ts'
import type { Gate, Mode } from './run-gates-types.ts'
import {
  ciWindowsBlockingGates,
  ciWindowsCompleteGates,
  ciWindowsObservationalGates,
} from './run-gates-windows.ts'

/**
 * Build the Node-compatibility aggregate for the running Node major.
 * @returns the compatibility gates.
 */
export function nodeCompatGates(): Gate[] {
  const typecheck = flagEnabled('DSH_NODE_COMPAT_SKIP_TYPECHECK')
    ? []
    : [pnpmScript('typecheck', 'typecheck')]
  if (runningNodeMajor() !== 22) {
    return [...typecheck, ...nodeCompatSmokeGates()]
  }
  return [
    ...typecheck,
    pnpmScript('build', 'build', {
      ...typecheck.length === 0 ? {} : { needs: ['typecheck'] },
    }),
    pnpmScript('build:web', 'build:web', {
      label: 'Web frontend build',
      needs: ['build'],
    }),
    ...nodeCompatSmokeGates({ cliSmoke: true }),
  ]
}

/**
 * Construct the complete gate list for a named aggregate.
 * @param selected - aggregate mode to construct.
 * @returns the aggregate's gate graph.
 */
export function gatesForMode(selected: Mode): Gate[] {
  switch (selected) {
    case 'ci-primary':
      return ciPrimaryGates()
    case 'ci-linux-primary':
      return [...ciPrimaryGates(), webSnapshotGate(['built-package-invariants'])]
    case 'ci-static':
      return ciStaticGates({ ownsBuild: false })
    case 'ci-lint-contracts-ready':
      return [
        lintGate(),
        pnpmScript('duplication', 'duplication'),
      ]
    case 'ci-coverage':
      return coverageGates()
    case 'ci-bench':
      return [pnpmScript('bench', 'test:bench', { label: 'performance benchmarks' })]
    case 'ci-snapshot':
      return [ciBuildGate(), snapshotGate()]
    case 'ci-artifacts':
      return ciArtifactGates()
    case 'ci-consumers':
      return ciConsumerGates()
    case 'ci-windows-blocking':
      return ciWindowsBlockingGates()
    case 'ci-windows-complete':
      return ciWindowsCompleteGates()
    case 'ci-windows-observational-ready':
      // The caller owns the successful workspace build; all diagnostics remain.
      return ciWindowsObservationalGates()
        .filter(gate => gate.id !== 'build')
        .map(gate => ({
          ...gate,
          ...gate.needs === undefined ? {} : { needs: gate.needs.filter(id => id !== 'build') },
          ...gate.after === undefined ? {} : { after: gate.after.filter(id => id !== 'build') },
        }))
    case 'node-compat':
      return nodeCompatGates()
    case 'check-all':
      return [
        pnpmScript('runtime-closure', 'verify-runtime-closure', { label: 'runtime closure' }),
        pnpmScript('cordis-config', 'verify-cordis-config', { label: 'Cordis config' }),
        pnpmScript('client-domain-graph', 'verify-client-domain-graph', { label: 'client domain graph' }),
        pnpmScript('test', 'test'),
        pnpmScript('approval-policy', 'test:approval-policy', { label: 'Weighted approval policy' }),
        pnpmScript('issue-management', 'test:issue-management', { label: 'Issue management policy' }),
        pnpmScript('duplication', 'duplication'),
        snapshotGate(),
        expectedOutputGate(),
        pnpmScript('build', 'build'),
        pnpmScript('build:web', 'build:web'),
        ...hygieneLeafGates({ artifactNeeds: ['build'] }),
        ...docSyncLeafGates({
          docTypecheckNeeds: ['build'],
          docTypecheckEnv: { DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1' },
          docTypecheckScript: 'doc-typecheck:contracts-ready',
        }),
        pnpmScript('module-graph', 'verify-module-graph', { label: 'module graph' }),
      ]
    case 'hygiene':
      return [
        ...hygieneLeafGates(),
        pnpmScript('cordis-config', 'verify-cordis-config', { label: 'Cordis config' }),
        pnpmScript('runtime-closure', 'verify-runtime-closure', { label: 'runtime closure' }),
      ]
    case 'doc-sync':
      return docSyncLeafGates()
    case 'doc-quick':
      return docQuickLeafGates()
  }
}
