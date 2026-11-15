/** The suppression and deprecation contract: unused directives, and where Session history reads are allowed. */

import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizedOutput,
  repositoryRoot,
  runOxlint,
  runRepositoryOxlint,
  writeContractConfig,
} from './oxlint-contract.harness-cases.ts'

describe('Oxlint executable contract', () => {
  it('reports an unused suppression', async () => {
    const suffix = randomUUID()
    const configPath = await writeContractConfig(suffix)
    const path = join(repositoryRoot, 'scripts', `oxlint-contract-${suffix}.ts`)

    try {
      await writeFile(path, '// oxlint-disable-next-line no-console\nexport const value = 1\n')
      const result = runOxlint([
        '--config',
        relative(repositoryRoot, configPath),
        '--format',
        'unix',
        relative(repositoryRoot, path),
      ])
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(0)
      expect(output).toContain('Unused oxlint-disable directive')
    } finally {
      await Promise.all([
        rm(path, { force: true }),
        rm(configPath, { force: true }),
      ])
    }
  }, 90_000)

  it('allows Session history reads only in tests or with existing-call waivers', async () => {
    const suffix = randomUUID()
    const configPath = await writeContractConfig(suffix)
    const exampleRoot = `examples/oxlint-contract-${suffix}`
    const examplePath = `${exampleRoot}/tests/reads.ts`
    const testPaths = [
      `packages/core/session/tests/oxlint-contract-${suffix}.ts`,
      `apps/cli/tests/oxlint-contract-${suffix}.ts`,
      examplePath,
      `scripts/oxlint-contract-${suffix}.spec.ts`,
    ]
    const productionPaths = [
      `packages/core/session/src/oxlint-contract-${suffix}.ts`,
      `scripts/oxlint-contract-${suffix}.ts`,
    ]
    const paths = [...testPaths, ...productionPaths]
    const reads = `import { Session, SessionSeq } from '@deepseek-ai/dsh-session'

export function reads(session: Session): void {
  session.snapshotEvents()
  session.eventAt(SessionSeq(0))
  session.ownEvents()
}
`
    const existing = `import { Session, SessionSeq } from '@deepseek-ai/dsh-session'

export function reads(session: Session): void {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  session.snapshotEvents()
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  session.eventAt(SessionSeq(0))
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  session.ownEvents()
}
`
    const unrelated = `
/** @deprecated Use the replacement API. */
function oldApi(): void {}

export function unrelatedRead(): void {
  oldApi()
}
`

    try {
      await mkdir(join(repositoryRoot, exampleRoot, 'tests'), { recursive: true })
      await writeFile(join(repositoryRoot, exampleRoot, 'tsconfig.json'), JSON.stringify({
        extends: '../../tsconfig.base.json',
        include: ['tests/**/*.ts'],
      }))
      await Promise.all([
        ...testPaths.map(path => writeFile(join(repositoryRoot, path), reads)),
        ...productionPaths.map(path => writeFile(join(repositoryRoot, path), existing)),
      ])
      const args = ['--config', relative(repositoryRoot, configPath), '--format', 'unix', ...paths]
      const allowed = runRepositoryOxlint(args)
      expect(allowed.error).toBeUndefined()
      expect(allowed.signal).toBeNull()
      expect(allowed.status, normalizedOutput(allowed)).toBe(0)

      await Promise.all([
        ...testPaths.map(path => writeFile(join(repositoryRoot, path), reads + unrelated)),
        ...productionPaths.map(path => writeFile(join(repositoryRoot, path), reads)),
      ])
      const rejected = runRepositoryOxlint(args)
      const output = normalizedOutput(rejected)
      expect(rejected.error).toBeUndefined()
      expect(rejected.signal).toBeNull()
      expect(rejected.status, output).toBe(1)
      const diagnostics = output.split('\n').filter(line => /:\d+:\d+: `\w+` is deprecated\./.test(line))
      for (const path of testPaths) {
        const reported = diagnostics.filter(line => line.startsWith(`${path}:`))
        expect(reported, output).toHaveLength(1)
        expect(reported[0]).toContain('`oldApi` is deprecated')
      }
      for (const path of productionPaths) {
        expect(diagnostics.filter(line => line.startsWith(`${path}:`)), output).toHaveLength(3)
      }
      for (const method of ['snapshotEvents', 'eventAt', 'ownEvents', 'oldApi']) {
        expect(output).toContain(`\`${method}\` is deprecated`)
      }
      expect(output).toContain(
        'See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).',
      )
    } finally {
      await Promise.all([
        ...paths.filter(path => path !== examplePath).map(path => rm(join(repositoryRoot, path), { force: true })),
        rm(join(repositoryRoot, exampleRoot), { recursive: true, force: true }),
        rm(configPath, { force: true }),
      ])
    }
  }, 90_000)
})
