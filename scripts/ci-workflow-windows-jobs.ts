import { describe, expect, it } from 'vitest'
import { evaluateRunsOn, isRecord, loadWorkflow } from './ci-workflow-helpers.ts'
import {
  expectFailoverSelectorEvaluation,
  expectFilesystemBranchedInstall,
  expectSerialWindowsStandby,
} from './ci-workflow-windows-checks.ts'

describe('CI workflow', () => {
  it('keeps split native Windows PR jobs with failover, plus a master-only standby', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const masterWorkflow = loadWorkflow('.github/workflows/ci-master.yml')
    if (!isRecord(workflow.jobs)
      || !isRecord(workflow.jobs['windows-build'])
      || !isRecord(workflow.jobs['windows-coverage'])
      || !isRecord(workflow.jobs['windows-native-tests'])
      || !isRecord(workflow.jobs['node-24'])
      || !isRecord(workflow.jobs['node-24-coverage'])
      || !isRecord(workflow.jobs['node-24-bench'])
      || !isRecord(workflow.jobs['node-24-consumers'])
      || !isRecord(workflow.jobs['node-compat'])
      || !isRecord(workflow.jobs['all-checks-passed'])
      || !isRecord(masterWorkflow.jobs)
      || !isRecord(masterWorkflow.jobs['serial-windows'])) {
      throw new TypeError('CI workflow must define windows-build, windows-coverage, windows-native-tests, node-24, node-24-coverage, node-24-bench, node-24-consumers, node-compat, and all-checks-passed; ci-master must define serial-windows')
    }

    const windowsBuild = workflow.jobs['windows-build']
    const windowsCoverage = workflow.jobs['windows-coverage']
    const windowsNativeTests = workflow.jobs['windows-native-tests']
    const serialWindows = masterWorkflow.jobs['serial-windows']
    const node24 = workflow.jobs['node-24']
    const node24Coverage = workflow.jobs['node-24-coverage']
    const node24Bench = workflow.jobs['node-24-bench']
    const node24Consumers = workflow.jobs['node-24-consumers']
    const nodeCompat = workflow.jobs['node-compat']
    const aggregate = workflow.jobs['all-checks-passed']
    if (!Array.isArray(aggregate.needs)) {
      throw new TypeError('CI aggregate must define needs')
    }
    // The split native jobs all resolve their pool through the Windows switch.
    for (const [jobName, job] of [['windows-build', windowsBuild], ['windows-coverage', windowsCoverage], ['windows-native-tests', windowsNativeTests]] as const) {
      expect(typeof job['runs-on']).toBe('string')
      expect(job['runs-on'], `${jobName} runs-on must use the Windows failover switch`).toContain('DSH_CI_FAILOVER_WINDOWS')
      expect(job['runs-on'], `${jobName} runs-on must not use the Linux failover switch`).not.toContain('DSH_CI_FAILOVER_LINUX')
      expect(job['runs-on']).toContain('self-hosted')
      expect(job['runs-on']).toContain('dsh-win-ci')
      expect(job['runs-on']).toContain('dsh-windows-2025-16core')
      const cores = jobName === 'windows-native-tests' ? 2 : 16
      expect(evaluateRunsOn(job['runs-on'], { vars: { DSH_CI_FAILOVER_WINDOWS: 'blacksmith' } }))
        .toBe(`blacksmith-${cores}vcpu-windows-2025`)
      expect(job.if).toBe("github.event_name == 'pull_request'")
    }

    // windows-build runs the blocking build/site pair.
    expect(windowsBuild.name).toBe('windows node 24 / build & observational')
    const buildSteps = windowsBuild.steps as unknown[]
    const buildCommands = buildSteps.filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))
    expect(buildCommands.map(step => step.run)).toContain('pnpm run check:ci:windows-blocking')

    // Native Windows installs branch on the workspace filesystem:
    // clone (ReFS block clone) only on ReFS, plain install elsewhere. This
    // keeps the TS6231 store-path leak (see the Windows ReFS store note) out
    // of the self-hosted pool without forcing clone onto hosted NTFS, which
    // rejects copy-on-write. The branch must stay, or a hosted fallback would
    // fail installs with ERR_PNPM_LINKING_FAILED.
    for (const [jobName, job] of [['windows-build', windowsBuild], ['windows-coverage', windowsCoverage], ['windows-native-tests', windowsNativeTests]] as const) {
      expectFilesystemBranchedInstall(jobName, job)
    }

    expect(windowsCoverage.name).toBe('windows node 24 / coverage')
    expect(windowsCoverage.env).toMatchObject({ DSH_COVERAGE_PARTITIONS: "${{ vars.DSH_CI_FAILOVER_WINDOWS == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]' && '4' || '' }}" })
    const coverageSteps = windowsCoverage.steps as unknown[]
    const coverageCommands = coverageSteps.filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))
    expect(coverageCommands.map(step => step.run)).toContain('pnpm run check:ci:coverage')
    // Windows coverage runs zero-build like the Linux lane: workspace imports
    // resolve to src through the tsconfig paths map, and the lib-consuming
    // suites (webworker-packer image-loadable, webworker-runtime
    // transform-corpus, client ui-trajectory client-bundle) self-skip on
    // unbuilt checkouts. The regex catches a regression spelled as
    // 'corepack pnpm run build' or folded into a multi-line run block, which
    // an exact string match would miss.
    expect(coverageCommands.every(step => !/\bpnpm\s+run\s+build(?:\s|$)/.test(step.run))).toBe(true)

    // windows-native-tests runs the Windows-specific specs.
    expect(windowsNativeTests.name).toBe('windows node 24 / native tests')
    const nativeTestSteps = windowsNativeTests.steps as unknown[]
    const nativeTestCommands = nativeTestSteps.filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))
    const nativeTestCommand = nativeTestCommands.map(step => step.run).join('\n')
    expect(nativeTestCommand).toContain('--no-file-parallelism')
    expect(nativeTestCommand).toContain('--testTimeout 90000')
    expect(nativeTestCommand).toContain('tool-pwsh/tests/loader.spec.ts')
    expect(nativeTestCommand).toContain('workflow-ptc.spec.ts')

    expect(workflow.jobs['windows-observational']).toBeUndefined()
    expect(windowsBuild['continue-on-error']).not.toBe(true)
    const observational = buildCommands.find(step => step.id === 'observational')
    expect(observational).toMatchObject({
      run: 'pnpm run check:ci:windows-observational-ready',
      shell: 'pwsh',
      'continue-on-error': true,
      'timeout-minutes': 15,
      env: {
        DSH_GATE_FAIL_FAST: '',
        DSH_PUBLINT_CONCURRENCY: "${{ vars.DSH_CI_FAILOVER_WINDOWS == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]' && '8' || '' }}",
      },
    })
    expect(observational?.if).toBeUndefined()
    expect(buildCommands.findIndex(step => step.id === 'observational'))
      .toBeGreaterThan(buildCommands.findIndex(step => step.run === 'pnpm run check:ci:windows-blocking'))
    const report = buildCommands.find(step => step.name === 'Report Windows observational failures')
    expect(report).toMatchObject({
      'continue-on-error': true,
      if: "steps.observational.outcome == 'failure'",
      shell: 'pwsh',
    })
    expect(report?.run).toContain('::warning::')
    expect(report?.run).toContain('Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Encoding utf8 -Append')

    // serial-windows: master-only standby, self-hosted, non-blocking, lives in ci-master.
    expect(serialWindows.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    expect(serialWindows['runs-on']).toEqual(['self-hosted', 'dsh-win-ci', 'windows'])
    expect(serialWindows.name).toBe('serial / windows (self-hosted standby)')
    expectSerialWindowsStandby(serialWindows)

    // windows-coverage is temporarily non-blocking while Windows ACP
    // half-close tests are stabilized; observational stays out too.
    expect(aggregate.needs).not.toContain('windows')
    expect(aggregate.needs).toContain('windows-build')
    // The benchmark lane is a required verdict input and runs alone so its
    // wall-clock budgets never share a runner with a concurrent aggregate.
    expect(aggregate.needs).toContain('node-24-bench')
    expect(node24Bench.name).toBe('node 24 / benchmarks')
    expect(node24Bench.env).toBeUndefined()
    expect(node24Bench.steps).toContainEqual({
      name: 'Install benchmark browser and hosted dependencies',
      run: 'pnpm --filter @deepseek-ai/dsh-benchmarks exec playwright install --with-deps chromium',
    })
    expect(JSON.stringify(node24Bench.steps)).not.toContain('DSH_CI_FAILOVER_LINUX')
    expect(node24Bench.steps).toContainEqual({
      name: 'Run performance benchmarks',
      env: { DSH_GATE_VERBOSE: '1' },
      run: 'pnpm run check:ci:bench',
    })
    expect(aggregate.needs).not.toContain('windows-coverage')
    expect(aggregate.needs).toContain('windows-native-tests')
    expect(aggregate.needs).not.toContain('windows-observational')
    expect(aggregate.needs).not.toContain('serial-windows')

    // Linux failover is a separate switch: the three enterprise Linux workers
    // and the verdict job resolve their pool through DSH_CI_FAILOVER_LINUX,
    // never the Windows switch.
    for (const [jobName, job] of [['node-24', node24], ['node-24-coverage', node24Coverage], ['node-24-consumers', node24Consumers]] as const) {
      expect(typeof job['runs-on']).toBe('string')
      expect(job['runs-on'], `${jobName} runs-on must use the Linux failover switch`).toContain('DSH_CI_FAILOVER_LINUX')
      expect(job['runs-on'], `${jobName} runs-on must not use the Windows failover switch`).not.toContain('DSH_CI_FAILOVER_WINDOWS')
      expect(job['runs-on']).toContain('vm-backup')
      expect(evaluateRunsOn(job['runs-on'], { vars: { DSH_CI_FAILOVER_LINUX: 'blacksmith' } }))
        .toBe(`blacksmith-${jobName === 'node-24' ? 8 : 16}vcpu-ubuntu-2404`)
    }
    expect(aggregate['runs-on']).toContain('DSH_CI_FAILOVER_LINUX')
    expect(aggregate['runs-on']).not.toContain('DSH_CI_FAILOVER_WINDOWS')
    expect(aggregate['runs-on']).toContain('vm-backup')
    expect(aggregate['runs-on']).toContain('blacksmith-4vcpu-ubuntu-2404')

    expectFailoverSelectorEvaluation({
      linux: node24['runs-on'] as string,
      linuxAggregate: aggregate['runs-on'] as string,
      windows: windowsBuild['runs-on'] as string,
    })

    // The run-gates aggregate lanes stop at the first blocking gate failure so
    // a red aggregate does not keep burning runner time on the remaining
    // gates. Removing the flag silently reverts to running every independent
    // gate to completion.
    for (const [jobName, job] of [['node-24', node24], ['node-24-coverage', node24Coverage], ['node-24-consumers', node24Consumers], ['node-compat', nodeCompat]] as const) {
      expect(job.env, `${jobName} must enable fail-fast`).toMatchObject({ DSH_GATE_FAIL_FAST: '1' })
    }

    // The native Windows lanes with run-gates aggregates fail fast for the
    // same reason: a failing gate aborts the sibling gate instead of waiting
    // out the multi-minute instrumented coverage run.
    expect(windowsBuild.env, 'windows-build must enable fail-fast').toMatchObject({ DSH_GATE_FAIL_FAST: '1' })
    expect(windowsCoverage.env, 'windows-coverage must enable fail-fast').toMatchObject({ DSH_GATE_FAIL_FAST: '1' })

    // The observational lane stays complete: it is continue-on-error by design
    // and exists to collect as much Windows-native evidence per run as
    // possible, so the first failure must not truncate the rest.
    expect(observational?.env).toMatchObject({ DSH_GATE_FAIL_FAST: '' })
  })
})
