/**
 * Aggregate builders for the CI lanes: primary, static, artifacts, and
 * built-artifact consumers.
 */
import { CLIENT_BUILD_PROFILE_SELECTOR } from './client-build-environment.ts'
import { ciSharedStaticGates, docSyncLeafGates } from './run-gates-hygiene.ts'
import {
  builtBinSmokeGate,
  builtPackageInvariantsGate,
  ciBuildGate,
  coverageGates,
  expectedOutputGate,
  lintGate,
  pnpmExec,
  pnpmScript,
  snapshotGate,
  typertContractsGate,
  webSnapshotGate,
} from './run-gates-leaves.ts'
import type { Gate } from './run-gates-types.ts'

/**
 * Build the primary CI aggregate: static checks, typecheck, lint, coverage,
 * snapshots, docs, and the build-artifact readers.
 * @returns the primary CI gates.
 */
export function ciPrimaryGates(): Gate[] {
  return [
    ...ciSharedStaticGates(),
    typertContractsGate(),
    pnpmScript('typecheck', 'typecheck:contracts-ready', { needs: ['typert-contracts'] }),
    lintGate({ needs: ['typert-contracts'] }),
    pnpmScript('duplication', 'duplication'),
    ...coverageGates(),
    ...nodeCompatSmokeGates(),
    snapshotGate(),
    ...docSyncLeafGates({
      docTypecheckNeeds: ['typert-contracts'],
      docTypecheckScript: 'doc-typecheck:contracts-ready',
    }),
    pnpmScript('module-graph', 'verify-module-graph', { label: 'module graph' }),
    // The prepared typecheck and build both drive Client tsc, while build also
    // repeats the Host contract pass. Wait for all three consumers so build
    // neither races tsbuildinfo nor replaces declarations while they are read.
    ciBuildGate('build', { needs: ['typecheck', 'lint', 'doc-typecheck'] }),
    // The engagement engine's own 753-test suite. It builds itself from source and
    // stamps the @secscan/* workspace deps, so it runs after the workspace build
    // has produced their lib/ output.
    pnpmScript('redteam-runner', 'test:redteam-runner', { needs: ['build'] }),
    pnpmScript('publint', 'publint', { needs: ['build'] }),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      needs: ['build'],
    }),
    builtPackageInvariantsGate(['build']),
    builtBinSmokeGate(),
  ]
}

/**
 * Build the Node version-compatibility smoke lanes.
 * @param options - whether to include the lane that needs a built CLI.
 * @returns the compatibility smoke gates.
 */
export function nodeCompatSmokeGates(options: { cliSmoke?: boolean } = {}): Gate[] {
  const gates: Gate[] = [
    pnpmExec('source-worker-smoke', [
      'vitest',
      'run',
      'packages/workflow/workflow-ptc/tests/source-runtime.compat.spec.ts',
    ], { label: 'source worker smoke' }),
    pnpmExec('jsonl-zstd-smoke', [
      'vitest',
      'run',
      'packages/session/session-persistence-jsonl/tests/zstd.compat.spec.ts',
    ], { label: 'JSONL Zstandard smoke' }),
    pnpmExec('dsh-source-launch-smoke', [
      'vitest',
      'run',
      'apps/cli/tests/source-launch.compat.spec.ts',
    ], { label: 'dsh source-launch smoke' }),
    pnpmExec('vitest-jsdom-smoke', [
      'vitest',
      'run',
      'scripts/vitest-environment.compat.spec.ts',
    ], { label: 'Vitest jsdom smoke' }),
    pnpmExec('profile-resolution-smoke', [
      'vitest',
      'run',
      'packages/boot/app-boot/tests/profile-resolution.spec.ts',
      'packages/boot/app-boot/tests/profile-resolution-service.spec.ts',
      'packages/boot/app-boot/tests/profile-resolution-worker-bootstrap.spec.ts',
    ], { label: 'profile resolution smoke' }),
  ]
  if (options.cliSmoke) {
    gates.push(
      pnpmExec('cli-lazy-search-startup-smoke', [
        'vitest',
        'run',
        'apps/cli/tests/lazy-search-startup.compat.spec.ts',
      ], {
        label: 'CLI lazy-search startup smoke',
        env: { DSH_REQUIRE_BUILT_CLI_SMOKE: '1' },
        needs: ['build:web'],
      }),
    )
  }
  return gates
}

/**
 * Build the static CI aggregate, optionally owning the workspace build.
 * @param options - whether this aggregate builds the workspace itself.
 * @returns the static CI gates.
 */
export function ciStaticGates(options: { ownsBuild: boolean }): Gate[] {
  return [
    ...ciSharedStaticGates(),
    ...options.ownsBuild ? [ciBuildGate()] : [],
    ...docSyncLeafGates({
      includeDocTypecheck: options.ownsBuild,
      ...options.ownsBuild
        ? {
          docTypecheckNeeds: ['build'],
          docTypecheckEnv: { DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1' },
          docTypecheckScript: 'doc-typecheck:contracts-ready',
        }
        : {},
      docsBuildScript: 'docs:build:mpa',
    }),
    pnpmScript('module-graph', 'verify-module-graph', { label: 'module graph' }),
  ]
}

/**
 * Build the published-artifact aggregate.
 * @returns the artifact gates.
 */
export function ciArtifactGates(): Gate[] {
  return [
    ciBuildGate(),
    pnpmScript('publint', 'publint', { needs: ['build'] }),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      needs: ['build'],
    }),
    builtPackageInvariantsGate(['build']),
    builtBinSmokeGate(),
  ]
}

/**
 * Build the built-artifact consumer aggregate.
 * @returns the consumer gates.
 */
export function ciConsumerGates(): Gate[] {
  const builtTree = ['build']
  const validatedBuild = ['built-package-invariants']
  // The HMR web test starts `dev:web`, which rewrites the shared `lib/` and
  // `apps/web/dist/` trees. Let every build-artifact reader settle before that
  // writer starts; `after` preserves the web diagnostic even if a reader fails.
  const buildArtifactReaders = [
    'publint',
    'lint-and-duplication',
    'snapshot',
    'expected-output',
    'doc-typecheck',
    'node-next-types',
    'built-bin-smoke',
  ]
  return [
    ciBuildGate(),
    pnpmScript('node-compat', 'check:node-compat', {
      label: 'Node compatibility',
      env: { [CLIENT_BUILD_PROFILE_SELECTOR]: 'official' },
    }),
    pnpmScript('publint', 'publint', { needs: builtTree }),
    builtPackageInvariantsGate(builtTree),
    pnpmScript('lint-and-duplication', 'check:ci:lint:contracts-ready', {
      label: 'lint and duplication',
      needs: validatedBuild,
    }),
    snapshotGate(validatedBuild),
    expectedOutputGate(validatedBuild),
    webSnapshotGate(validatedBuild, buildArtifactReaders),
    pnpmScript('doc-typecheck', 'doc-typecheck:contracts-ready', {
      needs: validatedBuild,
      env: { DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1' },
    }),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      needs: validatedBuild,
    }),
    builtBinSmokeGate(validatedBuild),
  ]
}
