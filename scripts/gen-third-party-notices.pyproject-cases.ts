/** Parsing of pyproject requirement arrays across TOML tables. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePyprojectRequirements } from './gen-third-party-notices.ts'

const root = resolve(import.meta.dirname, '..')

describe('parsePyprojectRequirements', () => {
  it('reads the committed manifests', () => {
    expect(parsePyprojectRequirements(readFileSync(resolve(root, 'python/sdk/pyproject.toml'), 'utf8'))).toContain('pydantic')
  })

  it('locates requirement arrays by TOML table, so author-named groups are not missed', () => {
    expect(parsePyprojectRequirements([
      '[build-system]',
      'requires = ["hatchling>=1.24.0"]',
      '',
      '[project]',
      'name = "not-a-requirement"',
      'dependencies = ["pydantic>=2.12"]',
      '',
      '[project.optional-dependencies]',
      'cli = ["click"]',
      '',
      '[dependency-groups]',
      'docs = ["sphinx>=7"]',
      '',
      '[tool.hatch.build.targets.wheel]',
      'packages = ["src/deepseek_harness"]',
      '',
      '[tool.pytest.ini_options]',
      'testpaths = ["tests"]',
    ].join('\n'))).toEqual(['hatchling', 'pydantic', 'click', 'sphinx'])
  })

  it('does not truncate an array at a bracket inside extras', () => {
    expect(parsePyprojectRequirements('[project]\ndependencies = ["httpx[http2]", "requests"]\n'))
      .toEqual(['httpx', 'requests'])
  })

  it('reads names whether or not requirements carry versions, extras, or markers', () => {
    expect(parsePyprojectRequirements("[project]\ndependencies = [\"pydantic>=2.12\", \"requests\", \"httpx[http2]\", \"tomli ; python_version < '3.11'\", \"hatchling >= 1.24.0\"]\n"))
      .toEqual(['pydantic', 'requests', 'httpx', 'tomli', 'hatchling'])
  })

  it('reads single-quoted TOML literals and rejects an unreadable requirement', () => {
    expect(parsePyprojectRequirements("[project]\ndependencies = ['requests', \"pydantic>=2\"]\n")).toEqual(['requests', 'pydantic'])
    expect(() => parsePyprojectRequirements('[project]\ndependencies = ["!!broken"]\n')).toThrow(/cannot read a distribution name/)
  })

  it('reads a multi-line array', () => {
    expect(parsePyprojectRequirements('[project]\ndependencies = [\n  "pydantic>=2.12",\n  "typing-extensions",\n]\n'))
      .toEqual(['pydantic', 'typing-extensions'])
  })

  it('obeys TOML comments, quoted keys, and escaped strings', () => {
    expect(parsePyprojectRequirements([
      '[project] # a legal header comment',
      'dependencies = [',
      '  "pydantic", # ] does not close the array',
      '  # "old-package" is not a dependency',
      '  "tomli; python_version < \'3.11\'",',
      ']',
      '',
      '[dependency-groups]',
      '"test.docs" = ["pytest"]',
    ].join('\n'))).toEqual(['pydantic', 'tomli', 'pytest'])
  })

  it('accepts dependency-group includes and rejects unsupported requirement forms', () => {
    expect(parsePyprojectRequirements('[dependency-groups]\nbase = ["pytest"]\nall = [{ include-group = "base" }]\n'))
      .toEqual(['pytest'])
    expect(() => parsePyprojectRequirements('[project]\ndependencies = "pytest"\n')).toThrow(/must be an array/)
    expect(() => parsePyprojectRequirements('[dependency-groups]\ntest = [{ unknown = "pytest" }]\n')).toThrow(/unsupported requirement entry/)
  })
})
