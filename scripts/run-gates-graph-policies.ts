/**
 * Gate graph policy: the repository checks each maintained mode must carry, and the Windows lane
 * that keeps its coverage gates blocking.
 */
import { describe, expect, it } from 'vitest'
import { gatesForMode } from './run-gates.ts'
import { withPnpmEntrypoint } from './run-gates-test-support.ts'

describe('gate graph validation', () => {
  it('launches a native pnpm entrypoint directly', () => {
    const entrypoint = String.raw`C:\Program Files\pnpm\pnpm.exe`
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-windows-blocking')[0], entrypoint)

    expect(subject).toMatchObject({
      command: entrypoint,
      args: ['run', 'build'],
    })
  })

  it.each(['ci-primary', 'ci-static', 'check-all'] as const)(
    'keeps the DSH package license policy in %s',
    (mode) => {
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))

      expect(ids).toContain('dsh-package-licenses')
    },
  )

  it.each(['ci-primary', 'ci-static', 'check-all', 'hygiene'] as const)(
    'rejects new unknown casts in %s',
    (mode) => {
      const gate = withPnpmEntrypoint(() => gatesForMode(mode).find(subject => subject.id === 'no-unknown-casts'))

      expect(gate?.args).toContain('verify-no-unknown-casts')
      expect(gate?.allowFailure).not.toBe(true)
    },
  )

  it.each(['ci-primary', 'ci-static', 'check-all', 'hygiene'] as const)(
    'keeps package dependency enforcement in %s',
    (mode) => {
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))

      expect(ids).toContain('package-dependencies')
    },
  )

  it.each(['ci-primary', 'ci-static', 'check-all', 'hygiene'] as const)(
    'executes default-product experimental isolation in %s',
    (mode) => {
      const gate = withPnpmEntrypoint(() => gatesForMode(mode)
        .find(subject => subject.id === 'default-product-isolation'))

      expect(gate?.args).toContain('verify-default-product-isolation')
      expect(gate?.allowFailure).not.toBe(true)
    },
  )

  it.each(['ci-primary', 'ci-static', 'check-all'] as const)(
    'keeps the client dependency policy in %s',
    (mode) => {
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))

      expect(ids).toContain('client-packages')
    },
  )

  it.each(['ci-primary', 'ci-static', 'check-all'] as const)(
    'keeps weighted approval policy tests in %s',
    (mode) => {
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))

      expect(ids).toContain('approval-policy')
    },
  )

  it.each(['ci-primary', 'ci-static', 'check-all', 'hygiene'] as const)(
    'keeps hard-coded Client UI copy enforcement in %s',
    (mode) => {
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))

      expect(ids).toContain('client-ui-i18n')
    },
  )

  it.each(['ci-primary', 'ci-static', 'check-all', 'hygiene'] as const)(
    'keeps browser app-route resolution enforcement in %s',
    (mode) => {
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))

      expect(ids).toContain('client-route-resolution')
    },
  )

  it.each(['ci-primary', 'ci-static', 'check-all', 'hygiene'] as const)(
    'keeps application entrypoint enforcement in %s',
    (mode) => {
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))

      expect(ids).toContain('application-entrypoints')
    },
  )

  it('keeps native Windows coverage blocking and behind the complete build', () => {
    const complete = withPnpmEntrypoint(() => gatesForMode('ci-windows-complete'))
    const observational = withPnpmEntrypoint(() => gatesForMode('ci-windows-observational-ready'))
      .filter(gate => gate.id !== 'docs-site-build')
    const byId = new Map(complete.map(subject => [subject.id, subject]))

    expect(byId.get('coverage')?.allowFailure).not.toBe(true)
    expect(byId.get('coverage')?.needs).toContain('build')
    expect(byId.get('coverage-exempt-heavy')?.allowFailure).not.toBe(true)
    expect(byId.get('coverage')?.needs).toContain('build')
    expect(byId.get('coverage-exempt-heavy')?.needs).toContain('build')
    expect(byId.get('coverage-exempt-heavy')?.args).toContain(
      'packages/experimental/webworker-packer/tests/image-loadable.spec.ts',
    )
    expect(observational).not.toHaveLength(0)
    for (const gate of observational) {
      const completeGate = byId.get(gate.id)
      expect(completeGate?.allowFailure).toBe(true)
      expect(completeGate?.after).toEqual(expect.arrayContaining([
        'coverage',
        'coverage-exempt-heavy',
      ]))
      expect((completeGate?.needs ?? []).filter(id => id !== 'build')).toEqual(gate.needs ?? [])
    }
  })
})
