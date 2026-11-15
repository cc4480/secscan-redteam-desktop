import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateRunsOn, isRecord, loadWorkflow, root, workflowJob } from './ci-workflow-helpers.ts'

describe('Runtime and LLM e2e Blacksmith routing', () => {
  it('routes DeepSeek e2e only through the Linux Blacksmith switch', () => {
    const job = workflowJob(loadWorkflow('.github/workflows/e2e.yml'), 'e2e')
    for (const mode of ['', 'selfhosted', 'unexpected', 'blacksmith']) {
      expect(evaluateRunsOn(job['runs-on'], { vars: { DSH_CI_FAILOVER_LINUX: mode, DSH_CI_FAILOVER_WINDOWS: 'blacksmith' } }))
        .toBe(mode === 'blacksmith' ? 'blacksmith-4vcpu-ubuntu-2404' : 'ubuntu-latest')
    }
  })

  it('keeps native release and dispatch builders hosted while routing x64 CI by platform', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    const build = workflowJob(workflow, 'build')
    for (const [target, runner, variable, blacksmith] of [
      ['node24-linux-x64', 'ubuntu-latest', 'DSH_CI_FAILOVER_LINUX', 'blacksmith-2vcpu-ubuntu-2404'],
      ['node24-win-x64', 'windows-2025', 'DSH_CI_FAILOVER_WINDOWS', 'blacksmith-2vcpu-windows-2025'],
      ['node24-linux-arm64', 'ubuntu-24.04-arm', 'DSH_CI_FAILOVER_LINUX', 'ubuntu-24.04-arm'],
      ['node24-macos-arm64', 'macos-latest', 'DSH_CI_FAILOVER_LINUX', 'macos-latest'],
      ['node24-macos-x64', 'macos-15-intel', 'DSH_CI_FAILOVER_LINUX', 'macos-15-intel'],
    ] as const) {
      for (const ci of [false, true]) {
        for (const release of [false, true]) {
          for (const mode of ['', 'selfhosted', 'unexpected', 'blacksmith']) {
            const vars = { DSH_CI_FAILOVER_LINUX: 'blacksmith', DSH_CI_FAILOVER_WINDOWS: 'blacksmith', [variable]: mode }
            expect(evaluateRunsOn(build['runs-on'], { inputs: { ci, release }, vars, matrix: { target, runner } }), `${target} ci=${ci} release=${release} mode=${mode}`)
              .toBe(ci && !release && mode === 'blacksmith' ? blacksmith : runner)
          }
        }
      }
    }
  })

  it.each(['plan', 'sdk-wheel'])('routes runtime %s only for non-release CI', (name) => {
    const job = workflowJob(loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml'), name)
    for (const ci of [false, true]) {
      for (const release of [false, true]) {
        for (const mode of ['', 'selfhosted', 'unexpected', 'blacksmith']) {
          expect(evaluateRunsOn(job['runs-on'], { inputs: { ci, release }, vars: { DSH_CI_FAILOVER_LINUX: mode } }))
            .toBe(ci && !release && mode === 'blacksmith' ? 'blacksmith-4vcpu-ubuntu-2404' : 'ubuntu-latest')
        }
      }
    }
  })
})

describe('bubblewrap preparation script', () => {
  it('pins bubblewrap to a recorded Launchpad build and excludes Ubuntu pool downloads', () => {
    const script = readFileSync(resolve(root, 'scripts/prepare-ci-bubblewrap.sh'), 'utf8')
    const url = /^readonly BUBBLEWRAP_URL="([^"]+)"$/mu.exec(script)?.[1]

    expect(url).toMatch(
      /^https:\/\/launchpad\.net\/ubuntu\/\+source\/bubblewrap\/[^/]+\/\+build\/\d+\/\+files\/bubblewrap_[^/]+_amd64\.deb$/u,
    )
    // Ubuntu removes superseded versions from its live package pool.
    expect(script).not.toMatch(/https?:\/\/[^/'"\s]+\/ubuntu(?:-ports)?\/pool\//u)
  })
})

describe('DeepSeek e2e workflow', () => {
  it('prepares bubblewrap from the pinned payload without a package transaction', () => {
    const workflow = loadWorkflow('.github/workflows/e2e.yml')
    const e2e = workflowJob(workflow, 'e2e')
    if (!Array.isArray(e2e.steps)) throw new TypeError('DeepSeek e2e workflow must define steps')

    const steps = e2e.steps.filter(isRecord)
    expect(steps.find(step => step.name === 'Prepare bubblewrap (unrestrict userns)')).toMatchObject({
      run: 'bash scripts/prepare-ci-bubblewrap.sh',
    })
    expect(JSON.stringify(steps)).not.toContain('apt-get')
  })

  it('bounds profile subprocess fan-out to the tested e2e default', () => {
    const workflow = loadWorkflow('.github/workflows/e2e.yml')
    const e2e = workflowJob(workflow, 'e2e')
    if (!Array.isArray(e2e.steps)) throw new TypeError('DeepSeek e2e workflow must define steps')

    const step = e2e.steps.filter(isRecord).find(candidate => candidate.name === 'E2E tests (real DeepSeek API)')
    expect(step).toMatchObject({ env: { DSH_E2E_MAX_WORKERS: 4 } })
  })
})
