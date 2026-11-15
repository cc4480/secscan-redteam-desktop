import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isRecord, loadWorkflow, root, workflowJob } from './ci-workflow-helpers.ts'

describe('CI workflow', () => {
  it('gates standalone keyless blacksmith jobs and benchmark tiers on the failover variables', () => {
    const expectedFilenames = workflowJob(loadWorkflow('.github/workflows/expected-filenames.yml'), 'expected-filenames')
    const sandbox = workflowJob(loadWorkflow('.github/workflows/sandbox.yml'), 'sandbox-e2e')
    expect(expectedFilenames['runs-on']).toContain('DSH_CI_FAILOVER_LINUX')
    expect(expectedFilenames['runs-on']).toContain("== 'blacksmith'")
    expect(expectedFilenames['runs-on']).toContain('blacksmith-4vcpu-ubuntu-2404')
    expect(expectedFilenames['runs-on']).toContain("'ubuntu-latest'")
    expect(sandbox['runs-on']).toContain("matrix.runner == 'bwrap'")
    expect(sandbox['runs-on']).toContain('DSH_CI_FAILOVER_LINUX')
    expect(sandbox['runs-on']).toContain('blacksmith-4vcpu-ubuntu-2404')
    for (const name of ['larger-runner-benchmark', 'consolidated-runner-benchmark'] as const) {
      const benchmark = workflowJob(loadWorkflow('.github/workflows/ci-master.yml'), name)
      if (!isRecord(benchmark.strategy) || !isRecord(benchmark.strategy.matrix) || !Array.isArray(benchmark.strategy.matrix.include)) {
        throw new TypeError(`${name} must define a matrix include list`)
      }
      expect(benchmark['runs-on']).toContain('matrix.blacksmith')
      expect(benchmark['runs-on']).toContain('DSH_CI_FAILOVER_LINUX')
      expect(benchmark['runs-on']).toContain('DSH_CI_FAILOVER_WINDOWS')
      for (const row of benchmark.strategy.matrix.include as Array<Record<string, string>>) {
        expect(typeof row.blacksmith, `${name} ${row.cores}-core row must declare a blacksmith label`).toBe('string')
        if (row.cores === '64' || row.cores === '96') {
          expect(row.blacksmith, `${name} ${row.cores}-core row has no Blacksmith tier`).toBe('')
        } else {
          expect(row.blacksmith).toContain(`blacksmith-${row.cores}vcpu`)
        }
      }
    }
  })

  it('runs required benchmarks on standard hosted Linux independently of failover', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const benchmark = workflowJob(workflow, 'node-24-bench')
    const aggregate = workflowJob(workflow, 'all-checks-passed')

    expect(benchmark['runs-on']).toBe('ubuntu-24.04')
    expect(benchmark.if).toBe("github.event_name == 'pull_request'")
    expect(benchmark.needs).toBeUndefined()
    expect(benchmark['continue-on-error']).toBeUndefined()
    expect(benchmark.env).toBeUndefined()
    expect(aggregate.needs).toContain('node-24-bench')
  })

  it('always restores the hosted benchmark pnpm cache', () => {
    const benchmark = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-24-bench')
    if (!Array.isArray(benchmark.steps)) throw new TypeError('benchmark job must define steps')
    const caches = benchmark.steps.filter(step => isRecord(step) && step.uses === 'actions/cache/restore@v4')

    expect(caches).toHaveLength(1)
    expect(caches[0]).not.toHaveProperty('if')
    expect(caches[0]).toMatchObject({
      with: {
        path: '${{ steps.pnpm-store.outputs.path }}',
        key: "${{ runner.os }}-node-${{ env.PRIMARY_NODE_VERSION }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}",
      },
    })
  })

  it('bounds the complete benchmark job to fifteen minutes', () => {
    const benchmark = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-24-bench')

    expect(benchmark['timeout-minutes']).toBe(15)
    expect(benchmark.steps).toContainEqual({
      name: 'Run performance benchmarks',
      env: { DSH_GATE_VERBOSE: '1' },
      run: 'pnpm run check:ci:bench',
    })
  })

  it('gives the Wine Host TypeScript compile the repository heap budget', () => {
    const wineGates = readFileSync(resolve(root, 'scripts/wine-windows-gates.sh'), 'utf8')

    expect(wineGates).toContain(
      'wine_node "$scratch/logs/host-tsc.log" --max-old-space-size=4096 "$tsc_js" -b tsconfig.host.json --pretty false',
    )
  })

  it('cancels superseded master runs without changing the post-merge job inventory', () => {
    const workflow = loadWorkflow('.github/workflows/ci-master.yml')
    const prWorkflow = loadWorkflow('.github/workflows/ci.yml')
    if (!isRecord(workflow.jobs) || !isRecord(workflow.concurrency)) {
      throw new TypeError('ci-master workflow must define jobs and a workflow-level concurrency block')
    }
    if (!isRecord(prWorkflow.jobs)) {
      throw new TypeError('ci workflow must define jobs')
    }

    expect(workflow.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    })
    expect(prWorkflow.concurrency).toEqual(workflow.concurrency)

    // The exact event sets are what keep master-only jobs out of the PR check
    // panel: ci-master triggers only on push(master) + workflow_dispatch and
    // never on pull_request; ci.yml is exactly pull_request-only. Assert the
    // full sets so losing the wrong event, or gaining an extra one, fails.
    if (!isRecord(workflow.on) || !isRecord(prWorkflow.on)) {
      throw new TypeError('both CI workflows must define on')
    }
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch'])
    expect(Object.keys(prWorkflow.on)).toEqual(['pull_request'])

    // Drills share the parent run’s supersession policy.
    for (const name of ['serial-linux-selfhosted', 'serial-windows']) {
      const job = workflow.jobs[name]
      if (!isRecord(job)) throw new TypeError(`${name} must be defined`)
      expect(job.concurrency).toBeUndefined()
      // Standby drills remain post-merge work, but share run cancellation.
      expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    }

    // Pin the post-merge runtime, Wine, and standby inventory.
    const NOT_PUSH_REACHABLE = new Set([
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'larger-runner-benchmark'",
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'consolidated-runner-benchmark'",
    ])
    const pushReachable = Object.entries(workflow.jobs)
      .filter(([, job]) => {
        if (!isRecord(job)) return false
        if (job.if === undefined) return true // unconditional: runs on every event
        if (job.if === false) return false // `if: false` parses as a boolean
        if (typeof job.if !== 'string') return true // unrecognized shape: surface it
        return !NOT_PUSH_REACHABLE.has(job.if.trim())
      })
      .map(([name]) => name)
      .sort()
    expect(pushReachable).toEqual(['python-runtime', 'serial-linux-selfhosted', 'serial-windows', 'windows'])

    // Manual benchmarks retain their bounded fan-out.
    for (const name of ['larger-runner-benchmark', 'consolidated-runner-benchmark']) {
      const job = workflow.jobs[name]
      if (!isRecord(job) || !isRecord(job.strategy)) {
        throw new TypeError(`${name} must define a matrix strategy`)
      }
      expect(job.strategy['max-parallel']).toBe(12)
      expect(job['timeout-minutes']).toBe(15)
    }
  })

  it('redirects the Node compile cache to the data-volume runner temp before the first pnpm call', () => {
    const prWorkflow = loadWorkflow('.github/workflows/ci.yml')
    const masterWorkflow = loadWorkflow('.github/workflows/ci-master.yml')
    const redirectLanes = [
      [prWorkflow, 'node-24'],
      [prWorkflow, 'node-24-coverage'],
      [prWorkflow, 'node-24-consumers'],
      [masterWorkflow, 'serial-linux-selfhosted'],
    ] as const
    for (const [workflow, jobKey] of redirectLanes) {
      const job = workflowJob(workflow, jobKey)
      if (!Array.isArray(job.steps)) throw new TypeError(`${jobKey} must define steps`)
      const redirectStepIndex = job.steps.findIndex((step): step is Record<string, unknown> & { run: string } => (
        isRecord(step) && typeof step.run === 'string'
          && step.run.includes('NODE_COMPILE_CACHE=${{ runner.temp }}/node-compile-cache')
          && step.run.includes('"$GITHUB_ENV"')
      ))
      // Removing this injection would send every pnpm call in the lane (setup,
      // store-path probe, install, and the gate) back to the root partition's
      // /tmp; rationale in
      // .agents/notes/implemented/process/2026-08-28-ci-node-compile-cache-data-disk.md.
      expect(redirectStepIndex, `${jobKey} must inject NODE_COMPILE_CACHE into GITHUB_ENV`).toBeGreaterThan(-1)
      const pnpmSetupIndex = job.steps.findIndex((step): step is Record<string, unknown> & { uses: string } => (
        isRecord(step) && typeof step.uses === 'string' && step.uses.includes('pnpm/action-setup')
      ))
      expect(pnpmSetupIndex, `${jobKey} must run pnpm/action-setup`).toBeGreaterThan(-1)
      expect(redirectStepIndex, `${jobKey} must redirect before pnpm/action-setup runs pnpm`).toBeLessThan(pnpmSetupIndex)
    }
  })

  it('keeps supported LSP source under native Windows coverage', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain('packages/lsp/lsp-stdio/src/connection.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/index.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/instance.ts')
  })

  it('requires release-shaped Python runtime validation on Linux and Windows x64', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const pythonRuntime = workflowJob(workflow, 'python-runtime')
    const aggregate = workflowJob(workflow, 'all-checks-passed')
    if (!Array.isArray(aggregate.needs)) {
      throw new TypeError('CI aggregate must define required job dependencies')
    }

    expect(pythonRuntime).toMatchObject({
      if: "github.event_name == 'pull_request'",
      name: 'python runtime / release-shaped matrix',
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: {
        targets: 'node24-linux-x64,node24-win-x64',
        ci: true,
      },
      secrets: {
        DEEPSEEK_API_KEY_EXTERNAL: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}',
      },
    })
    expect(aggregate.needs).toContain('python-runtime')
  })

  it('keeps every Vitest project process-isolated on native Windows', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain("pool: process.platform === 'win32' ? 'threads' : 'forks'")
    expect(config.match(/pool: 'forks'/g)).toHaveLength(2)
  })
})
