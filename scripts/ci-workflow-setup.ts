import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import {
  isRecord,
  loadWorkflow,
  nativeWindowsPnpmDestination,
  root,
  runnerPrivatePnpmDestination,
  workflowJob,
} from './ci-workflow-helpers.ts'

describe('CI workflow', () => {
  it('prepares confinement before Node compatibility smokes', () => {
    const job = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-compat')
    if (!Array.isArray(job.steps)) throw new TypeError('Node compatibility job must define steps')
    const steps = job.steps.filter(isRecord)
    const preparation = steps.findIndex(step => step.run === 'bash scripts/prepare-ci-bubblewrap.sh')
    const smoke = steps.findIndex(step => step.run === 'pnpm run check:node-compat')
    expect(preparation).toBeGreaterThanOrEqual(0)
    expect(smoke).toBeGreaterThan(preparation)
    expect(steps[preparation]).not.toHaveProperty('continue-on-error', true)
  })

  it.each(['ci.yml', 'ci-master.yml', 'e2e.yml', 'release.yml', 'release-vendor.yml'])(
    '%s cancels superseded validation runs without crossing workflow or ref boundaries', (name) => {
      const workflow = loadWorkflow('.github/workflows/' + name)
      expect(workflow.concurrency).toEqual({
        group: '${{ github.workflow }}-${{ github.ref }}',
        'cancel-in-progress': true,
      })
    },
  )

  it('cancels reusable CI builds without cancelling release-owned builds', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(workflow.concurrency).toEqual({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': '${{ !inputs.release }}',
    })
  })

  it('does not cancel protected publication or deployment transactions', () => {
    for (const name of ['release-publish.yml', 'release-vendor-publish.yml']) {
      const publish = workflowJob(loadWorkflow('.github/workflows/' + name), 'publish')
      expect(publish.concurrency).toMatchObject({ 'cancel-in-progress': false })
    }
    for (const name of ['python-release.yml', 'node-addon-system-release.yml', 'docs-pages.yml']) {
      expect(loadWorkflow('.github/workflows/' + name).concurrency).toMatchObject({ 'cancel-in-progress': false })
    }
  })

  it('skips coverage-history uploads on cancellation but retains Wine cleanup', () => {
    const coverage = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'windows-coverage')
    const wine = workflowJob(loadWorkflow('.github/workflows/ci-master.yml'), 'windows')
    expect(coverage.steps).toContainEqual(expect.objectContaining({
      name: 'Save coverage duration history', if: '${{ !cancelled() }}',
    }))
    expect(wine.steps).toContainEqual(expect.objectContaining({ name: 'Shut down wineserver', if: 'always()' }))
  })

  it('isolates every pnpm action setup destination per runner', () => {
    const files = ['.github/workflows/ci.yml', '.github/workflows/ci-master.yml']
    const setups: Array<{ jobName: string; step: unknown }> = []
    for (const file of files) {
      const workflow: unknown = yaml.load(readFileSync(resolve(root, file), 'utf8'))
      if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (!isRecord(job) || !Array.isArray(job.steps)) continue
        for (const step of job.steps) {
          if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
          setups.push({ jobName, step })
        }
      }
    }

    expect(setups.length).toBeGreaterThan(0)
    for (const { jobName, step } of setups) {
      const stepDest = (step as { with?: { dest?: unknown } }).with?.dest
      if (jobName.startsWith('windows-')) {
        expect(stepDest, `${jobName} must use the native Windows pnpm destination`).toBe(nativeWindowsPnpmDestination)
        expect(step).not.toMatchObject({ with: { standalone: true } })
      } else {
        expect(typeof stepDest, `${jobName} must use a runner-and-run-private pnpm destination`).toBe('string')
        expect(stepDest as string).toMatch(runnerPrivatePnpmDestination)
      }
    }
  })

  it.each(['node-24', 'node-24-coverage', 'node-24-consumers'])(
    '%s keeps tool and fixture temporary files under runner cleanup',
    (jobName) => {
      const job = workflowJob(loadWorkflow('.github/workflows/ci.yml'), jobName)
      if (!Array.isArray(job.steps)) throw new TypeError(`${jobName} must define steps`)
      expect(job.steps[0]).toEqual({
        name: 'Use runner-owned temporary storage',
        run: [
          'echo "TMPDIR=${{ runner.temp }}" >> "$GITHUB_ENV"',
          ...(jobName === 'node-24-consumers'
            ? ['echo "PLAYWRIGHT_BROWSERS_PATH=${RUNNER_TEMP%/*}/ms-playwright" >> "$GITHUB_ENV"']
            : []),
          '',
        ].join('\n'),
      })
      if (jobName === 'node-24-consumers') {
        const browserCache: unknown = job.steps.find(step => isRecord(step) && isRecord(step.with)
          && step.with.path === '${{ env.PLAYWRIGHT_BROWSERS_PATH }}')
        expect(browserCache).toMatchObject({ uses: 'actions/cache/restore@v4' })
      }
      const store: unknown = job.steps.find(step => isRecord(step) && step.name === 'Configure pnpm store path')
      expect(store).toMatchObject({
        run: [
          'store_root="$HOME/.local/share/pnpm/store"',
          'echo "PNPM_CONFIG_STORE_DIR=$store_root" >> "$GITHUB_ENV"',
          'store_path=$(PNPM_CONFIG_STORE_DIR="$store_root" pnpm store path --silent)',
          'echo "path=$store_path" >> "$GITHUB_OUTPUT"',
          '',
        ].join('\n'),
      })
      for (const step of job.steps) {
        if (isRecord(step) && isRecord(step.env)) {
          expect(step.env.TMPDIR).toBeUndefined()
          expect(step.env.npm_config_cache).toBeUndefined()
        }
      }
    },
  )

  it('isolates the python SDK exe pnpm setup destination per job', () => {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/build-exe-for-python-sdk.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError('build-exe-for-python-sdk.yml must define jobs')
    const setups: Array<{ step: unknown }> = []
    for (const job of Object.values(workflow.jobs)) {
      if (!isRecord(job) || !Array.isArray(job.steps)) continue
      for (const step of job.steps) {
        if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
        setups.push({ step })
      }
    }
    expect(setups.length).toBeGreaterThan(0)
    for (const { step } of setups) {
      expect(step).toMatchObject({
        with: { dest: nativeWindowsPnpmDestination },
      })
    }
  })
})
