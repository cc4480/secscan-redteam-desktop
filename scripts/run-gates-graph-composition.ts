/**
 * Gate graph composition: which gates each maintained mode constructs, in which order, and with
 * which command and inherited script policy.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { defaultConcurrency, gatesForMode, runGates, type Gate } from './run-gates.ts'
import { resultFor, withPnpmEntrypoint } from './run-gates-test-support.ts'

describe('gate graph validation', () => {
  it.each([
    'ci-primary',
    'ci-linux-primary',
    'ci-static',
    'ci-lint-contracts-ready',
    'ci-coverage',
    'ci-bench',
    'ci-snapshot',
    'ci-artifacts',
    'ci-consumers',
    'ci-windows-blocking',
    'ci-windows-complete',
    'ci-windows-observational-ready',
    'node-compat',
    'check-all',
    'hygiene',
    'doc-sync',
    'doc-quick',
  ] as const)('constructs and executes preflight for a valid non-empty %s graph', async (mode) => {
    const subject = withPnpmEntrypoint(() => gatesForMode(mode))
    const execute = vi.fn((item: Gate) => Promise.resolve(resultFor(item)))

    await expect(runGates(subject, subject.length, execute)).resolves.toHaveLength(subject.length)
  })

  it('builds the native addon before benchmarks through the ci-bench script chain', () => {
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-bench'))
    const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(scripts['check:ci:bench']).toBe('tsx scripts/run-gates.ts ci-bench')
    expect(subject).toHaveLength(1)
    expect(subject[0]).toMatchObject({
      id: 'bench',
      displayCommand: 'pnpm run test:bench',
      args: ['/private/pnpm.cjs', 'run', 'test:bench'],
    })
    expect(scripts['test:bench']).toBe('npm run build:bench && npm run build:web && npm run test:bench:built')
    expect(scripts['build:bench']).toBe(
      'npm run build:native-system && npm run build:lib && tsdown --config benchmarks/tsdown.config.ts',
    )
    expect(scripts['build:native-system']).toBe('tsx native/system/scripts/build.ts --host-addon-only')
    expect(scripts['test:bench:built']).toBe('vitest run --config vitest.bench.config.ts')
  })

  it('checks all maintained repository references locally and in CI', () => {
    const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>
    }
    for (const mode of ['doc-sync', 'doc-quick', 'ci-static'] as const) {
      const gates = withPnpmEntrypoint(() => gatesForMode(mode))
      expect(gates).toContainEqual(expect.objectContaining({
        id: 'repository-references',
        displayCommand: 'pnpm run verify-repository-references',
      }))
    }
    expect(scripts['verify-repository-references']).toBe('tsx scripts/verify-repository-references.ts')
  })

  it('keeps the public repository link policy in the documentation gate', () => {
    const ids = withPnpmEntrypoint(() => gatesForMode('doc-sync').map(subject => subject.id))

    expect(ids).toContain('public-repository-links')
  })

  it('keeps the concrete terminology policy in the documentation gate', () => {
    const ids = withPnpmEntrypoint(() => gatesForMode('doc-sync').map(subject => subject.id))

    expect(ids).toContain('concrete-terms')
  })

  it('checks retrospective releases alongside the current persistence history', () => {
    for (const mode of ['doc-sync', 'ci-static'] as const) {
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))
      expect(ids).toEqual(expect.arrayContaining(['persistence-changes', 'persistence-releases']))
    }
  })

  it('requires complete Session format references locally and in CI', () => {
    const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>
    }
    for (const mode of ['doc-sync', 'doc-quick', 'ci-static'] as const) {
      expect(withPnpmEntrypoint(() => gatesForMode(mode))).toContainEqual(expect.objectContaining({
        id: 'persistence-formats',
        displayCommand: 'pnpm run verify-persistence-formats',
      }))
    }
    expect(scripts['verify-persistence-formats']).toBe('tsx scripts/persistence-formats.ts')
  })

  it('keeps package-group subsystem ownership in the documentation gate', () => {
    const ids = withPnpmEntrypoint(() => gatesForMode('doc-sync').map(subject => subject.id))

    expect(ids).toContain('subsystem-pages')
  })

  it('keeps the package README Summary limit in the documentation gate', () => {
    const ids = withPnpmEntrypoint(() => gatesForMode('doc-sync').map(subject => subject.id))

    expect(ids).toContain('package-readme-summaries')
  })

  it('derives the quick documentation aggregate from marked doc-sync leaves', () => {
    const full = withPnpmEntrypoint(() => gatesForMode('doc-sync'))
    const quick = withPnpmEntrypoint(() => gatesForMode('doc-quick'))

    expect(quick).toEqual(full.filter(gate => gate.quick === true))
  })

  it('checks the recorded npm dependency catalog in both documentation aggregates', () => {
    for (const mode of ['doc-sync', 'doc-quick'] as const) {
      expect(withPnpmEntrypoint(() => gatesForMode(mode).find(gate => gate.id === 'dependency-catalog')))
        .toMatchObject({ args: ['/private/pnpm.cjs', 'run', 'verify-dependency-catalog'] })
    }
  })

  it('keeps the hygiene aggregate aligned with the package script checks', () => {
    const ids = withPnpmEntrypoint(() => gatesForMode('hygiene').map(subject => subject.id))

    expect(ids).toEqual([
      'rescope-vendor', 'publint', 'constraints', 'default-product-isolation', 'package-dependencies', 'application-entrypoints',
      'dsh-package-licenses', 'package-invariants', 'built-package-invariants', 'node-next-types',
      'optional-dependency-imports', 'client-packages', 'client-ui-i18n', 'client-route-resolution', 'no-bare-dispatcher',
      'no-unknown-casts',
      'file-budget', 'prompt-budget',
      'cordis-config', 'runtime-closure',
    ])
  })

  it('caps the local hygiene aggregate at four workers', () => {
    const ids = withPnpmEntrypoint(() => gatesForMode('hygiene').map(subject => subject.id))

    expect(defaultConcurrency('hygiene', ids.length, 8)).toEqual({
      workers: 4,
      source: '8 available CPU(s), hygiene cap 4',
    })
  })

  it('schedules the longest documentation leaves before short checks', () => {
    const ids = withPnpmEntrypoint(() => gatesForMode('doc-sync').map(subject => subject.id))

    expect(ids.slice(0, 11)).toEqual([
      'doc-typecheck', 'docs-site-build', 'doc-graphs', 'markdown-links', 'type-equivalence',
      'cordis-catalog', 'cordis-inspect-catalog', 'workflow-guest', 'mermaid', 'scoped-events', 'translation-pairing',
    ])
  })
})
