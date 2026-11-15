/** The staged, project-free profile: selection, source rules, and fix retry output. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  isRecord,
  normalizedOutput,
  repositoryRoot,
  runOxlint,
  runRepositoryOxlint,
} from './oxlint-contract.harness-cases.ts'

describe('Oxlint executable contract', () => {
  it('accepts an ignored-only staged selection', () => {
    const result = runOxlint([
      '--fix',
      '--no-error-on-unmatched-pattern',
      'scripts/install-lefthook.mjs',
    ])

    expect(result.error).toBeUndefined()
    expect(result.status, normalizedOutput(result)).toBe(0)
  })

  it('keeps staged validation project-free while preserving source rules', async () => {
    const configPath = join(repositoryRoot, '.oxlintrc.staged.json')
    const result = parseConfigFileTextToJson(configPath, await readFile(configPath, 'utf8'))
    if (result.error !== undefined) {
      throw new Error(flattenDiagnosticMessageText(result.error.messageText, '\n'))
    }
    const stagedConfig: unknown = result.config
    if (!isRecord(stagedConfig)) throw new Error('.oxlintrc.staged.json must contain a config object')
    expect(stagedConfig).toMatchObject({
      extends: ['./.oxlintrc.json'],
      options: { typeAware: false },
    })
    expect(stagedConfig.ignorePatterns).not.toContain('packages/typert/generator/tests/fixtures/type-model/**')

    const suffix = randomUUID()
    const path = join(repositoryRoot, 'scripts', `staged-lint-probe-${suffix}.ts`)
    try {
      await writeFile(path, 'export const value={answer:1};\n')
      const lint = runOxlint([
        '--config',
        relative(repositoryRoot, configPath),
        '--format',
        'unix',
        relative(repositoryRoot, path),
      ])
      const output = normalizedOutput(lint)

      expect(lint.error).toBeUndefined()
      expect(lint.status, output).toBe(1)
      expect(output).toContain('@stylistic')
      expect(output).not.toContain('typescript(')
    } finally {
      await rm(path, { force: true })
    }
  })

  it('preserves successful fix output channels', async () => {
    const suffix = randomUUID()
    const path = join(repositoryRoot, 'scripts', `staged-lint-probe-${suffix}.ts`)

    try {
      await writeFile(path, '// oxlint-disable-next-line no-console\nexport const value = 1\n')
      const result = runRepositoryOxlint([
        '--config',
        '.oxlintrc.staged.json',
        '--format',
        'unix',
        '--fix',
        relative(repositoryRoot, path),
      ])

      expect(result.error).toBeUndefined()
      expect(result.status, normalizedOutput(result)).toBe(0)
      expect(result.stdout).toContain('Unused oxlint-disable directive')
      expect(result.stderr).toBe('')
    } finally {
      await rm(path, { force: true })
    }
  })

  it('prints only the final diagnostics when a fix retry still fails', async () => {
    const suffix = randomUUID()
    const path = join(repositoryRoot, 'scripts', `staged-lint-probe-${suffix}.ts`)

    try {
      await writeFile(path, `export const longProbe = ${'1 + '.repeat(80)}1\n`)
      const result = runRepositoryOxlint([
        '--config',
        '.oxlintrc.staged.json',
        '--format',
        'unix',
        '--fix',
        relative(repositoryRoot, path),
      ])
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(1)
      expect(output.match(/@stylistic\(max-len\)/g)).toHaveLength(1)
    } finally {
      await rm(path, { force: true })
    }
  })

  it.each(['--fix', '--fix-suggestions', '--fix-dangerously'])(
    'converges overlapping staged stylistic fixes through Oxlint under %s',
    async (fixFlag) => {
      const suffix = randomUUID()
      const directory = join(repositoryRoot, 'scripts', `.oxlint-contract-${suffix}`)
      const path = join(directory, 'fix.ts')

      try {
        await mkdir(directory, { recursive: true })
        await writeFile(path, 'const value={answer:1};  \nconsole.log(value)\n')

        const relativePath = relative(repositoryRoot, path)
        const lintResult = runRepositoryOxlint(['--config', '.oxlintrc.staged.json', fixFlag, relativePath])

        expect(lintResult.error).toBeUndefined()
        expect(lintResult.status, normalizedOutput(lintResult)).toBe(0)
        expect(normalizedOutput(lintResult)).not.toContain('@stylistic')
        await expect(readFile(path, 'utf8')).resolves.toBe('const value={ answer:1 }\nconsole.log(value)\n')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    90_000,
  )
})
