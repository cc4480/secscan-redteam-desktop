/**
 * Node and platform lanes: the jsdom smoke on every advertised Node line, the source-only static
 * lane, the artifact consumers of the build, and the Linux primary graph.
 */
import { describe, expect, it } from 'vitest'
import { defaultConcurrency, gatesForMode } from './run-gates.ts'
import { withPnpmEntrypoint } from './run-gates-test-support.ts'

describe('Node compatibility graph', () => {
  it('runs the jsdom environment smoke on every advertised Node line', () => {
    const subject = withPnpmEntrypoint(() => gatesForMode('node-compat'))

    expect(subject.find(item => item.id === 'vitest-jsdom-smoke')).toMatchObject({
      label: 'Vitest jsdom smoke',
      args: [
        '/private/pnpm.cjs',
        'exec',
        'vitest',
        'run',
        'scripts/vitest-environment.compat.spec.ts',
      ],
    })
  })
})

describe('Node 24 lane ownership', () => {
  it('keeps the static lane source-only', () => {
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-static'))

    expect(subject.map(item => item.id)).not.toContain('build')
    expect(subject.map(item => item.id)).not.toContain('doc-typecheck')
  })

  it('owns the build and orders its artifact consumers', () => {
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-consumers'))

    expect(defaultConcurrency('ci-consumers', subject.length, 4)).toEqual({
      workers: 4,
      source: '4 available CPU(s)',
    })
    expect(subject.map(item => item.id)).toEqual([
      'build',
      'node-compat',
      'publint',
      'built-package-invariants',
      'lint-and-duplication',
      'snapshot',
      'expected-output',
      'web-snapshot',
      'doc-typecheck',
      'node-next-types',
      'built-bin-smoke',
    ])
    expect(subject.find(item => item.id === 'publint')?.needs).toEqual(['build'])
    expect(subject.find(item => item.id === 'build')?.env).toEqual({
      DSH_BUILD_CLIENT_PROFILE: 'official',
    })
    expect(subject.find(item => item.id === 'node-compat')?.env).toEqual({
      DSH_BUILD_CLIENT_PROFILE: 'official',
    })
    expect(subject.find(item => item.id === 'built-package-invariants')?.needs).toEqual(['build'])
    expect(subject.find(item => item.id === 'lint-and-duplication')?.needs).toEqual(['built-package-invariants'])
    for (const id of [
      'snapshot',
      'expected-output',
      'web-snapshot',
      'doc-typecheck',
      'node-next-types',
      'built-bin-smoke',
    ]) {
      expect(subject.find(item => item.id === id)?.needs).toEqual(['built-package-invariants'])
    }
    expect(subject.find(item => item.id === 'snapshot')?.env).toEqual({ DSH_EXAMPLE_MODE: 'lib' })
    expect(subject.find(item => item.id === 'expected-output')?.env).toEqual({ DSH_EXAMPLE_MODE: 'lib' })
    expect(subject.find(item => item.id === 'built-bin-smoke')?.env).toEqual({ DSH_EXAMPLE_MODE: 'lib' })
    expect(subject.find(item => item.id === 'doc-typecheck')?.env).toEqual({
      DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1',
    })
    expect(subject.find(item => item.id === 'built-bin-smoke')?.args).toEqual(
      expect.arrayContaining([
        'apps/cli/tests/profiles/headless/tests/source-tool.built.e2e.ts',
        'packages/subprocess/subprocess-local/tests/spawn-runner-built.e2e.ts',
        'packages/subagent/subagent-codex/tests/loader-composition.e2e.ts',
        'packages/subagent/subagent-claude-code/tests/loader-composition.e2e.ts',
        'packages/experimental/agent-team/tests/built-lib.e2e.ts',
      ]),
    )
    expect(subject.find(item => item.id === 'web-snapshot')).toMatchObject({
      displayCommand: 'DSH_SNAPSHOT=replay pnpm run test:web:built',
      env: { DSH_SNAPSHOT: 'replay' },
      after: [
        'publint',
        'lint-and-duplication',
        'snapshot',
        'expected-output',
        'doc-typecheck',
        'node-next-types',
        'built-bin-smoke',
      ],
    })
  })
})

describe('Linux primary graph', () => {
  it('adds the same compare-only web gate after built client artifacts', () => {
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-linux-primary'))
    const web = subject.find(item => item.id === 'web-snapshot')

    expect(web).toMatchObject({
      displayCommand: 'DSH_SNAPSHOT=replay pnpm run test:web:built',
      env: { DSH_SNAPSHOT: 'replay' },
      needs: ['built-package-invariants'],
    })
  })
})
