/**
 * Leaf gate builders shared by every aggregate: pnpm invocations plus the
 * gates that wrap one package script or one Vitest lane.
 */
import { CLIENT_BUILD_PROFILE_SELECTOR } from './client-build-environment.ts'
import { COVERAGE_EXEMPT_ENV, coverageExemptHeavySuites } from './coverage-exempt.ts'
import {
  COVERAGE_PARTITIONS_ENV,
  COVERAGE_TEST_TIMEOUT_ENV,
  coverageTestTimeoutArgs,
  parseCoveragePartitionCount,
} from './coverage-partitions.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'
import { positiveIntArg } from './run-gates-environment.ts'
import type { Gate } from './run-gates-types.ts'

/**
 * Build a gate that runs one package script.
 * @param id - gate id used by dependency edges.
 * @param script - package script name.
 * @param options - overrides for label, dependencies, and environment.
 * @returns the gate descriptor.
 */
export function pnpmScript(id: string, script: string, options: Partial<Gate> = {}): Gate {
  return {
    id,
    label: options.label ?? script,
    displayCommand: `pnpm run ${script}`,
    ...pnpmInvocation(['run', script]),
    ...options,
  }
}

/** Build official client artifacts inside a CI aggregate without changing sibling gate environments. */
export function ciBuildGate(id = 'build', options: Partial<Gate> = {}): Gate {
  return pnpmScript(id, 'build', {
    ...options,
    env: { ...options.env, [CLIENT_BUILD_PROFILE_SELECTOR]: 'official' },
  })
}

/**
 * Build a gate that runs one `pnpm exec` command.
 * @param id - gate id used by dependency edges.
 * @param args - executable and its arguments.
 * @param options - overrides for label, dependencies, and environment.
 * @returns the gate descriptor.
 */
export function pnpmExec(id: string, args: string[], options: Partial<Gate> = {}): Gate {
  return {
    id,
    label: options.label ?? `pnpm exec ${args.join(' ')}`,
    displayCommand: `pnpm exec ${args.join(' ')}`,
    ...pnpmInvocation(['exec', ...args]),
    ...options,
  }
}

/**
 * Build the browser snapshot gate, honoring the caller's worker override.
 * @param needs - gate ids that must pass first.
 * @param after - gate ids that must settle first, whatever their outcome.
 * @returns the web snapshot gate.
 */
export function webSnapshotGate(needs: string[], after?: string[]): Gate {
  const order = after === undefined ? { needs } : { needs, after }
  const workerRaw = process.env.DSH_WEB_SNAPSHOT_WORKERS
  if (workerRaw !== undefined && workerRaw !== '') {
    const workers = Number.parseInt(workerRaw, 10)
    if (!Number.isSafeInteger(workers) || workers < 1 || String(workers) !== workerRaw) {
      throw new Error(`run-gates: DSH_WEB_SNAPSHOT_WORKERS must be a positive integer, got ${JSON.stringify(workerRaw)}.`)
    }
    return pnpmScript('web-snapshot', 'test:web:ci', {
      label: 'web browser snapshot',
      displayCommand: `DSH_SNAPSHOT=replay DSH_WEB_SNAPSHOT_WORKERS=${workers} pnpm run test:web:ci`,
      env: { DSH_SNAPSHOT: 'replay' },
      ...order,
      streamOutput: true,
    })
  }
  return pnpmScript('web-snapshot', 'test:web:built', {
    label: 'web browser snapshot',
    displayCommand: 'DSH_SNAPSHOT=replay pnpm run test:web:built',
    env: { DSH_SNAPSHOT: 'replay' },
    ...order,
  })
}

/** Build the gate that prepares the Typert contract declarations. */
export function typertContractsGate(): Gate {
  return pnpmScript('typert-contracts', 'build:lib:host', { label: 'Typert contracts' })
}

/**
 * Build the lint gate, surfacing the caller's thread override in its display command.
 * @param options - gate dependencies to apply.
 * @returns the lint gate.
 */
export function lintGate(options: { needs?: string[] } = {}): Gate {
  const raw = process.env.DSH_OXLINT_THREADS
  const script = 'lint:contracts-ready'
  return pnpmScript('lint', script, {
    ...raw === undefined || raw === ''
      ? {}
      : { displayCommand: `DSH_OXLINT_THREADS=${raw} pnpm run ${script}` },
    ...options.needs === undefined ? {} : { needs: options.needs },
  })
}

// The heavy suites run uninstrumented beside the thresholded gate: their
// compiler- and subprocess-bound fixtures pay a multiple of their runtime
// under v8 instrumentation while contributing nothing the thresholds need
// (membership rules in scripts/coverage-exempt.ts).
//
// DSH_COVERAGE_MAX_WORKERS is shared between the two parallel gates. CI
// defaults its partition count to the instrumented share; an explicit
// DSH_COVERAGE_PARTITIONS overrides that share independently. The exempt
// gate's wall clock is dominated by its longest single file, so it takes the
// small share. A budget of 1 gives each gate 1 worker; lanes that need a strict
// total of one (the serial reference jobs) also set DSH_GATE_CONCURRENCY=1,
// which keeps the gates from overlapping at all.
// DSH_COVERAGE_TEST_TIMEOUT_MS raises Vitest's per-test, expect.poll, and hook
// defaults together for instrumented lanes whose scheduling overhead exceeds
// those defaults. Explicit fixture timeouts remain authoritative.
function coverageWorkerArgs(): { instrumented: string[]; exempt: string[] } {
  const [flag] = positiveIntArg('DSH_COVERAGE_MAX_WORKERS', '--maxWorkers')
  if (flag === undefined) return { instrumented: [], exempt: [] }
  const total = Number.parseInt(flag.split('=')[1] ?? '', 10)
  const exempt = Math.max(1, Math.floor(total / 3))
  const instrumented = Math.max(1, total - exempt)
  return {
    instrumented: [`--maxWorkers=${String(instrumented)}`],
    exempt: [`--maxWorkers=${String(exempt)}`],
  }
}

/**
 * Build the coverage aggregate: the thresholded lane beside the exempt heavy suites.
 * @returns the coverage gates.
 */
export function coverageGates(): Gate[] {
  const workers = coverageWorkerArgs()
  const timeouts = coverageTestTimeoutArgs(process.env[COVERAGE_TEST_TIMEOUT_ENV])
  const partitions = parseCoveragePartitionCount(process.env[COVERAGE_PARTITIONS_ENV])
  const instrumented = partitions === undefined
    ? pnpmExec('coverage', [
      'vitest',
      'run',
      '--coverage',
      ...workers.instrumented,
      ...timeouts,
    ], {
      label: 'test:coverage',
      env: { [COVERAGE_EXEMPT_ENV]: '1' },
    })
    : pnpmScript('coverage', 'test:coverage:partitioned', {
      label: 'test:coverage',
      displayCommand: `${COVERAGE_PARTITIONS_ENV}=${partitions} pnpm run test:coverage:partitioned`,
      env: { [COVERAGE_EXEMPT_ENV]: '1' },
      streamOutput: true,
    })
  return [
    pnpmScript('native-system', 'build:native-system'),
    { ...instrumented, needs: ['native-system'] },
    pnpmExec('coverage-exempt-heavy', [
      'vitest',
      'run',
      ...coverageExemptHeavySuites.map(suite => suite.filter),
      ...workers.exempt,
      ...timeouts,
    ], {
      label: 'test:coverage-exempt-heavy',
      needs: ['native-system'],
    }),
  ]
}

// Recorded-session adapters boot process scenarios in `lib` mode. Callers wait
// either on `build` or on a validation gate that transitively owns that build.
export function snapshotGate(needs: string[] = ['build']): Gate {
  return pnpmScript('snapshot', 'test:snapshot', {
    env: { DSH_EXAMPLE_MODE: 'lib' },
    needs,
  })
}

// Owner-local process expectations consume built package exports without entering
// the recorded-session corpus or the credentialed provider lane.
export function expectedOutputGate(needs: string[] = ['build']): Gate {
  return pnpmScript('expected-output', 'test:expected', {
    env: { DSH_EXAMPLE_MODE: 'lib' },
    needs,
  })
}

/**
 * Build the built-package invariants gate.
 * @param needs - gate ids that must pass first.
 * @returns the built package invariants gate.
 */
export function builtPackageInvariantsGate(needs?: string[]): Gate {
  return pnpmScript('built-package-invariants', 'verify-built-package-invariants', {
    label: 'built package invariants',
    ...needs === undefined ? {} : { needs },
  })
}

/**
 * Build the smoke lane over built binaries and built package entrypoints.
 * @param needs - gate ids that must pass first.
 * @returns the built-bin smoke gate.
 */
export function builtBinSmokeGate(needs: string[] = ['build']): Gate {
  return pnpmExec('built-bin-smoke', [
    'vitest',
    'run',
    '--config',
    'vitest.e2e.config.ts',
    'apps/cli/tests/profiles/headless/tests/keyless-smoke.e2e.ts',
    'apps/cli/tests/profiles/headless/tests/source-tool.built.e2e.ts',
    'apps/cli/tests/built-bin.e2e.ts',
    'packages/host/directory-picker-native/tests/built-worker.e2e.ts',
    'packages/sdk/server/tests/built-scope-carrier.e2e.ts',
    'packages/deliverables/tool-present/tests/built-errors.e2e.ts',
    'packages/subprocess/subprocess-local/tests/spawn-runner-built.e2e.ts',
    'packages/subagent/subagent-codex/tests/loader-composition.e2e.ts',
    'packages/subagent/subagent-claude-code/tests/loader-composition.e2e.ts',
    'packages/api/remotes/tests/built-lib.e2e.ts',
    'packages/experimental/agent-team/tests/built-lib.e2e.ts',
    // Built execution consumers: the only automated proof that package-name
    // imports reach their lib/ entrypoints under plain Node. The e2e lane runs
    // unbuilt, so these files self-skip there.
    'packages/workflow/workflow-ptc/tests/built-runtime.e2e.ts',
    'packages/ptc-runtime/ptc-runtime-node/tests/built-lib.e2e.ts',
    'packages/session/session-persistence-jsonl/tests/built-migration-worker.e2e.ts',
    'packages/lsp/lsp-stdio/tests/built-lib.e2e.ts',
  ], {
    label: 'built-bin smoke',
    needs,
    env: { DSH_EXAMPLE_MODE: 'lib' },
  })
}
