/** The TypeScript project each file class resolves to for Oxlint's type-aware rules. */

import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizedOutput,
  repositoryRoot,
  runOxlint,
  writeContractConfig,
} from './oxlint-contract.harness-cases.ts'

describe('Oxlint executable contract', () => {
  it('discovers the owning TypeScript project for every file class', async () => {
    const suffix = randomUUID()
    const configPath = await writeContractConfig(suffix)
    const probes = [
      ['host package source', 'packages/fs/fs-observation-policy/src', 'packages/fs/fs-observation-policy/tsconfig.json'],
      ['host package test', 'packages/fs/fs-observation-policy/tests', 'tsconfig.host.json'],
      ['client package source', 'packages/client/ui-primitives/src', 'packages/client/ui-primitives/tsconfig.json'],
      // A test under packages/client states its face in the filename, so the
      // probe carries the Client suffix to reach the Client aggregate.
      ['client package test', 'packages/client/ui-trajectory/tests', 'tsconfig.client.json', '.client.ts'],
      ['CLI profile test', 'apps/cli/tests/profiles/headless/tests', 'tsconfig.host.json'],
      ['website', 'website', 'tsconfig.host.json'],
    ] as const
    const source = `export function probePromise(): Promise<void> {
  return Promise.resolve()
}

probePromise()
`

    try {
      const paths: Array<readonly [label: string, path: string, tsconfig: string]> = []
      for (const [label, parent, tsconfig, extension = '.ts'] of probes) {
        const path = join(repositoryRoot, parent, `oxlint-contract-${suffix}${extension}`)
        await writeFile(path, source)
        paths.push([label, relative(repositoryRoot, path), tsconfig])
      }
      const clientScript = 'scripts/client-bundle-purity.spec.ts'

      const result = runOxlint([
        '--config',
        relative(repositoryRoot, configPath),
        '--format',
        'unix',
        ...paths.map(([, path]) => path),
        clientScript,
      ], { OXC_LOG: 'debug' })
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(1)
      for (const [label, path, tsconfig] of paths) {
        expect(output, label).toContain(`${path.replaceAll('\\', '/')}:5:1: Promises must be awaited`)
        expect(output, `${label} project`).toContain(
          `Got tsconfig for file ${join(repositoryRoot, path).replaceAll('\\', '/')}: ${join(repositoryRoot, tsconfig).replaceAll('\\', '/')}`,
        )
      }
      expect(output.match(/typescript\(no-floating-promises\)/g)).toHaveLength(probes.length)
      expect(output, 'client aggregate script project').toContain(
        `Got tsconfig for file ${join(repositoryRoot, clientScript).replaceAll('\\', '/')}: ${join(repositoryRoot, 'tsconfig.client.json').replaceAll('\\', '/')}`,
      )
      expect(output).not.toContain('Unmatched file:')
    } finally {
      await Promise.all([
        ...probes.map(([, parent, , extension = '.ts']) =>
          rm(join(repositoryRoot, parent, `oxlint-contract-${suffix}${extension}`), { force: true })),
        rm(configPath, { force: true }),
      ])
    }
  }, 90_000)
})
