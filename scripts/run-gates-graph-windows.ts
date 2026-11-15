/**
 * Windows lane reuse: the observational lane must run the same diagnostics as the complete lane
 * over an existing build, with one configured coverage timeout and partition policy.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gatesForMode, runGates } from './run-gates.ts'
import { resultFor, withEnv, withPnpmEntrypoint } from './run-gates-test-support.ts'

describe('gate graph validation', () => {
  it('runs the Windows built-bin smoke after other observational gates settle', () => {
    const observational = withPnpmEntrypoint(() => gatesForMode('ci-windows-observational-ready'))
    const builtBin = observational.find(gate => gate.id === 'built-bin-smoke')

    expect(builtBin?.after).toEqual(
      observational.filter(gate => gate.id !== 'built-bin-smoke').map(gate => gate.id),
    )

    const completeBuiltBin = withPnpmEntrypoint(() => gatesForMode('ci-windows-complete'))
      .find(gate => gate.id === 'built-bin-smoke')
    expect(completeBuiltBin?.after).toContain('windows-site')
    expect(completeBuiltBin?.after).not.toContain('docs-site-build')
  })

  it('reuses the Windows build without dropping diagnostics or rebuilding the workspace', () => {
    const ready = withPnpmEntrypoint(() => gatesForMode('ci-windows-observational-ready'))
    const complete = withPnpmEntrypoint(() => gatesForMode('ci-windows-complete'))
    const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(scripts['check:ci:windows-observational-ready']).toBe('tsx scripts/run-gates.ts ci-windows-observational-ready')
    expect(scripts).not.toHaveProperty('check:ci:windows-observational')
    const completeOnly = new Set(['build', 'windows-site', 'native-system', 'coverage', 'coverage-exempt-heavy'])
    const shared = complete.filter(gate => !completeOnly.has(gate.id))
    expect(ready.map(gate => gate.id).sort()).toEqual([...shared.map(gate => gate.id), 'docs-site-build'].sort())
    expect(ready.some(gate => gate.id === 'build')).toBe(false)
    expect(ready.find(gate => gate.id === 'docs-site-build')?.displayCommand).toBe('pnpm run docs:build:mpa')
    for (const diagnostic of shared) {
      expect(ready.find(gate => gate.id === diagnostic.id)).toMatchObject({
        command: diagnostic.command,
        args: diagnostic.args,
      })
      expect(ready.find(gate => gate.id === diagnostic.id)?.env).toEqual(diagnostic.env)
    }
    expect(complete.find(gate => gate.id === 'build')).toBeDefined()
    expect(complete.find(gate => gate.id === 'coverage')).toBeDefined()
  })

  it('runs built Windows smoke after failed diagnostics settle on an existing build', async () => {
    const ready = withPnpmEntrypoint(() => gatesForMode('ci-windows-observational-ready'))
    const settled = new Set<string>()
    const results = await runGates(ready, 8, (subject) => {
      if (subject.id === 'built-bin-smoke') {
        expect(settled.size).toBe(ready.length - 1)
        expect(settled.has('doc-graphs')).toBe(true)
      }
      settled.add(subject.id)
      return Promise.resolve(resultFor(subject, subject.id === 'doc-graphs' ? 'failed' : 'passed'))
    })

    expect(results.filter(result => result.status === 'failed').map(result => result.gate.id)).toEqual(['doc-graphs'])
    expect(results.find(result => result.gate.id === 'built-bin-smoke')?.status).toBe('passed')
    expect(results.some(result => result.status === 'skipped')).toBe(false)
  })

  it('applies one configured test, polling, and hook timeout to both coverage gates', () => {
    const gates = withEnv('DSH_COVERAGE_TEST_TIMEOUT_MS', '15000', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete')))

    for (const id of ['coverage', 'coverage-exempt-heavy']) {
      expect(gates.find(subject => subject.id === id)?.args).toEqual(expect.arrayContaining([
        '--testTimeout=15000',
        '--expect.poll.timeout=15000',
        '--hookTimeout=15000',
      ]))
    }
  })

  it('keeps Vitest timeout defaults when the coverage override is absent', () => {
    const gates = withEnv('DSH_COVERAGE_TEST_TIMEOUT_MS', undefined, () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete')))

    for (const id of ['coverage', 'coverage-exempt-heavy']) {
      expect(gates.find(subject => subject.id === id)?.args).not.toEqual(expect.arrayContaining([
        expect.stringMatching(/^--(?:testTimeout|expect\.poll\.timeout|hookTimeout)=/),
      ]))
    }
  })

  it('rejects an invalid coverage timeout before starting a gate', () => {
    expect(() => withEnv('DSH_COVERAGE_TEST_TIMEOUT_MS', '0', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete'))))
      .toThrow('DSH_COVERAGE_TEST_TIMEOUT_MS must be a positive integer')
  })

  it('selects partitioned coverage only when explicitly configured', () => {
    const coverage = withEnv('DSH_COVERAGE_PARTITIONS', '3', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete').find(subject => subject.id === 'coverage')))

    expect(coverage).toMatchObject({
      displayCommand: 'DSH_COVERAGE_PARTITIONS=3 pnpm run test:coverage:partitioned',
      args: ['/private/pnpm.cjs', 'run', 'test:coverage:partitioned'],
      env: { DSH_COVERAGE_EXEMPT_HEAVY: '1' },
      streamOutput: true,
    })
  })

  it('rejects an invalid coverage partition count before starting a gate', () => {
    expect(() => withEnv('DSH_COVERAGE_PARTITIONS', '1', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete'))))
      .toThrow('DSH_COVERAGE_PARTITIONS must be an integer greater than 1')
  })
})
