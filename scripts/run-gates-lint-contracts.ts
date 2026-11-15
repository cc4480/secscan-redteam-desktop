/**
 * Lint and Typert contract preparation: the Oxlint worker bound the lint gate surfaces, and the
 * contract build the source consumers depend on.
 */
import { describe, expect, it } from 'vitest'
import { gatesForMode } from './run-gates.ts'
import { withEnv, withPnpmEntrypoint } from './run-gates-test-support.ts'

describe('Oxlint gate', () => {
  it('uses the package script when no worker bound is configured', () => {
    const subject = withEnv('DSH_OXLINT_THREADS', undefined, () =>
      withPnpmEntrypoint(() => gatesForMode('ci-lint-contracts-ready')[0]))

    expect(subject).toMatchObject({
      id: 'lint',
      displayCommand: 'pnpm run lint:contracts-ready',
      command: process.execPath,
      args: ['/private/pnpm.cjs', 'run', 'lint:contracts-ready'],
    })
  })

  it('surfaces the configured worker bound on the shared package script', () => {
    const subject = withEnv('DSH_OXLINT_THREADS', '4', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-lint-contracts-ready')[0]))

    expect(subject).toMatchObject({
      id: 'lint',
      displayCommand: 'DSH_OXLINT_THREADS=4 pnpm run lint:contracts-ready',
      command: process.execPath,
      args: ['/private/pnpm.cjs', 'run', 'lint:contracts-ready'],
    })
  })
})

describe('Typert contract preparation', () => {
  it('prepares primary source consumers once before they run', () => {
    const subject = withEnv('DSH_OXLINT_THREADS', undefined, () =>
      withPnpmEntrypoint(() => gatesForMode('ci-primary')))

    expect(subject.find(item => item.id === 'typert-contracts')).toMatchObject({
      displayCommand: 'pnpm run build:lib:host',
      args: ['/private/pnpm.cjs', 'run', 'build:lib:host'],
    })
    for (const [id, script] of [
      ['typecheck', 'typecheck:contracts-ready'],
      ['lint', 'lint:contracts-ready'],
      ['doc-typecheck', 'doc-typecheck:contracts-ready'],
    ] as const) {
      expect(subject.find(item => item.id === id)).toMatchObject({
        displayCommand: `pnpm run ${script}`,
        args: ['/private/pnpm.cjs', 'run', script],
        needs: ['typert-contracts'],
      })
    }
    expect(subject.find(item => item.id === 'build')?.needs).toEqual([
      'typecheck',
      'lint',
      'doc-typecheck',
    ])
  })

  it('reuses contracts from the validated consumer build', () => {
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-consumers'))

    expect(subject.find(item => item.id === 'lint-and-duplication')).toMatchObject({
      displayCommand: 'pnpm run check:ci:lint:contracts-ready',
      args: ['/private/pnpm.cjs', 'run', 'check:ci:lint:contracts-ready'],
    })
    expect(subject.find(item => item.id === 'doc-typecheck')).toMatchObject({
      displayCommand: 'pnpm run doc-typecheck:contracts-ready',
      args: ['/private/pnpm.cjs', 'run', 'doc-typecheck:contracts-ready'],
    })
  })

  it('keeps standalone doc sync responsible for preparation', () => {
    const docTypecheck = withPnpmEntrypoint(() =>
      gatesForMode('doc-sync').find(item => item.id === 'doc-typecheck'))

    expect(docTypecheck?.displayCommand).toBe('pnpm run doc-typecheck')
  })
})
