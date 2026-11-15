import { expect } from 'vitest'
import { evaluateRunsOn, isRecord } from './ci-workflow-helpers.ts'

/**
 * Assert a looked-up step is present and narrow it to its defined type.
 * @param value - Step expected to be defined.
 * @param message - Failure message naming the required step.
 * @returns the step without `undefined`.
 */
function required<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined()
  if (value === undefined) throw new TypeError(message)
  return value
}

/**
 * Assert a native Windows job installs with the filesystem-branched pnpm command.
 * @param jobName - Job id, used in failure messages.
 * @param job - Parsed job definition.
 */
export function expectFilesystemBranchedInstall(jobName: string, job: Record<string, unknown>): void {
  const steps = job.steps as unknown[]
  const install = required(
    steps.find((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && step.name === 'Install (immutable)' && typeof step.run === 'string'
    )),
    `${jobName} must define the filesystem-branched install`,
  )
  expect(install.run).toContain("$fs -eq 'ReFS'")
  expect(install.run).toContain('--package-import-method=clone')
  expect(install.run).toContain('corepack pnpm install')
  // The else branch must keep the plain hosted install as a distinct line
  // (not the corepack clone line, which contains the same substring);
  // dropping it or making both branches clone would force clone onto
  // NTFS, which rejects copy-on-write (ERR_PNPM_LINKING_FAILED). The
  // YAML folded block keeps the first statement on line 1 and folds the
  // rest with leading two-space indents.
  const installLines = install.run.split('\n').map(line => line.trim())
  expect(installLines).toContain('} else {')
  expect(installLines.some(line => line === 'pnpm install --frozen-lockfile'), `${jobName} else branch must keep the plain hosted install`).toBe(true)
  // The ReFS branch must not use the interpolated empty-flag form, which
  // passes a stray "" positional argument to pnpm.
  expect(install.run).not.toContain('$cloneFlag')
}

/**
 * Assert the master-only serial Windows standby keeps the shared store volume,
 * the filesystem-branched install, and the unsharded coverage budget.
 * @param serialWindows - Parsed `serial-windows` job definition.
 */
export function expectSerialWindowsStandby(serialWindows: Record<string, unknown>): void {
  // Its store must share the ReFS workspace volume for clone; the install
  // must carry the same filesystem branch as the PR jobs.
  const serialSteps = serialWindows.steps as unknown[]
  const serialStore = required(
    serialSteps.find((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && step.name === 'Configure persistent pnpm store' && typeof step.run === 'string'
    )),
    'serial-windows must define the persistent pnpm store',
  )
  expect(serialStore.run).toContain('[IO.Path]::GetPathRoot($env:GITHUB_WORKSPACE)')
  expect(serialStore.run).toContain("'.pnpm-store'")
  const serialInstall = required(
    serialSteps.find((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && step.name === 'Install (immutable)' && typeof step.run === 'string'
    )),
    'serial-windows must define the filesystem-branched install',
  )
  expect(serialInstall.run).toContain("$fs -eq 'ReFS'")
  expect(serialInstall.run).toContain('--package-import-method=clone')
  expect(serialInstall.run).toContain('corepack pnpm install')
  // Distinct else-branch line, as for the PR jobs: the corepack clone line
  // contains the plain-install substring too.
  expect(serialInstall.run.split('\n').map(line => line.trim())).toContain('} else {')
  expect(serialInstall.run.split('\n').map(line => line.trim())).toContain('pnpm install --frozen-lockfile')
  expect(serialInstall.run).not.toContain('$cloneFlag')
  // The unsharded reference runs the whole coverage inventory at the same
  // per-test budget the PR coverage lane grants; the default 5000ms times
  // out load-sensitive store scans (e.g. gen-third-party-notices).
  const serialGate = required(
    serialSteps.find((step): step is Record<string, unknown> & { env?: Record<string, unknown> } => (
      isRecord(step) && step.name === 'Run complete unsharded Windows gate inventory serially'
    )),
    'serial-windows must define the unsharded gate inventory step',
  )
  expect(serialGate.env).toMatchObject({ DSH_COVERAGE_TEST_TIMEOUT_MS: '90000' })
}

/** Raw runner selectors whose failover branches are evaluated in full. */
export interface FailoverSelectors {
  readonly linux: string
  readonly linuxAggregate: string
  readonly windows: string
}

/**
 * Evaluate each failover selector against every variable value and identity.
 * @param selectors - Raw `runs-on` expressions of the Linux gates, the Linux
 * aggregate, and the Windows lanes.
 */
export function expectFailoverSelectorEvaluation(selectors: FailoverSelectors): void {
  // Evaluating the full selector, not just substring containment, proves the
  // blacksmith branch is standalone: it must not fall through to the
  // self-hosted pool when the two values are mutually exclusive.
  const evaluate = (expression: string, vars: Record<string, string>, login = 'maintainer'): unknown => {
    return evaluateRunsOn(expression, {
      vars,
      fromJSON: JSON.parse,
      github: { event: { pull_request: { user: { login } } } },
    })
  }
  for (const [name, selector, variable, pool, hosted] of [
    ['linux gates', selectors.linux, 'DSH_CI_FAILOVER_LINUX', ['self-hosted', 'linux', 'x64', 'vm-backup'], 'dsh-ubuntu-24-04-16core'],
    ['linux aggregate', selectors.linuxAggregate, 'DSH_CI_FAILOVER_LINUX', ['self-hosted', 'linux', 'x64', 'vm-backup'], 'ubuntu-latest'],
    ['windows lanes', selectors.windows, 'DSH_CI_FAILOVER_WINDOWS', ['self-hosted', 'dsh-win-ci', 'windows'], 'dsh-windows-2025-16core'],
  ] as const) {
    expect(evaluate(selector, { [variable]: 'blacksmith' }), `${name} blacksmith value`).toMatch(/^blacksmith-/)
    expect(evaluate(selector, { [variable]: 'selfhosted' }), `${name} selfhosted value`).toEqual(pool)
    // The blacksmith branch must not capture the selfhosted pool, and the
    // dependabot exclusion applies to the pool, not to the blacksmith tier.
    expect(evaluate(selector, { [variable]: 'selfhosted' }, 'dependabot[bot]'), `${name} dependabot on selfhosted`).toBe(hosted)
    for (const mode of ['', 'hosted', 'unexpected']) {
      expect(evaluate(selector, { [variable]: mode }), `${name} default on ${mode}`).toBe(hosted)
    }
  }
}
