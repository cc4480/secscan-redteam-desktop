import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectPackageDependencyViolations,
  fixPackageDependencies,
  repairPackageDependencyManifest,
  type PackageDependencyFacts,
  type PackageDependencyManifest,
} from './verify-package-dependencies.ts'
import {
  CORDIS,
  cleanupRoots,
  facts,
  roots,
  sourceFacts,
} from './verify-package-dependencies.fixtures.ts'

afterEach(cleanupRoots)

describe('dependency sections', () => {
  it.each(['client-only', 'client-host'] as const)('moves unused third-party and CSS inputs to development dependencies for %s', (role) => {
    const subject = sourceFacts({
      'src/index.ts': "import 'host-runtime'",
    }, {
      dependencies: { 'unused-browser-dep': '^1.2.3', '@fontsource/test-font': '~2.0.0', 'host-runtime': '^3.0.0' },
      optionalDependencies: { 'unused-optional': '^4.0.0' },
    }, role)

    repairPackageDependencyManifest(subject)
    expect(subject.manifest.devDependencies).toMatchObject({
      'unused-browser-dep': '^1.2.3',
      '@fontsource/test-font': '~2.0.0',
      'unused-optional': '^4.0.0',
    })
    expect(subject.manifest.dependencies).toEqual(role === 'client-host' ? { 'host-runtime': '^3.0.0' } : undefined)
    expect(subject.manifest.optionalDependencies).toBeUndefined()
    const repaired = structuredClone(subject.manifest)
    repairPackageDependencyManifest(subject)
    expect(subject.manifest).toEqual(repaired)
  })

  it('preserves unreferenced third-party declarations in configured Host packages', () => {
    const subject = sourceFacts({ 'src/index.ts': 'export function apply() {}' }, {
      dependencies: { 'unused-host-dep': '^1.0.0' },
      optionalDependencies: { 'unused-host-optional': '^2.0.0' },
    }, 'configured-host')

    repairPackageDependencyManifest(subject)
    expect(subject.manifest.dependencies).toEqual({ 'unused-host-dep': '^1.0.0' })
    expect(subject.manifest.optionalDependencies).toEqual({ 'unused-host-optional': '^2.0.0' })
  })

  it.each(['peerDependencies', 'optionalDependencies'] as const)('rejects browser-only imports declared in %s', (section) => {
    const subject = sourceFacts({
      'src/index.ts': 'export function apply() {}',
      'src/client/index.ts': "import 'external'",
    }, {
      devDependencies: { [CORDIS]: 'workspace:~' },
      peerDependencies: { [CORDIS]: 'workspace:~' },
      [section]: { [CORDIS]: 'workspace:~', external: '~1.2.3' },
      peerDependenciesMeta: { external: { optional: true } },
    })
    if (section === 'optionalDependencies') delete subject.manifest.optionalDependencies?.[CORDIS]
    const state = { facts: [subject], packages: [], policyViolations: [], workspaceNames: subject.workspaceNames }

    expect(collectPackageDependencyViolations(state)).toContainEqual(
      expect.stringContaining(`must be devDependencies-only; found ${section}`),
    )
    repairPackageDependencyManifest(subject)
    expect(subject.manifest.devDependencies?.external).toBe('~1.2.3')
    expect(subject.manifest[section]?.external).toBeUndefined()
    expect(subject.manifest.peerDependenciesMeta).toBeUndefined()
    expect(collectPackageDependencyViolations(state)).toEqual([])
  })

  it('rejects a missing third-party declaration and leaves the in-memory manifest unchanged', () => {
    const subject = sourceFacts({
      'src/index.ts': 'export function apply() {}',
      'src/client/index.ts': "import 'undeclared'",
    })
    const before = structuredClone(subject.manifest)
    const state = { facts: [subject], packages: [], policyViolations: [], workspaceNames: subject.workspaceNames }

    expect(collectPackageDependencyViolations(state)).toContain(
      'packages/g/probe/package.json: undeclared (packages/g/probe/src/client/index.ts) '
      + 'must be devDependencies-only; found no dependency section',
    )
    expect(() => { repairPackageDependencyManifest(subject) }).toThrow(
      'packages/g/probe/package.json: cannot repair undeclared third-party dependency undeclared; declare its version range first',
    )
    expect(subject.manifest).toEqual(before)
  })

  it('validates every third-party range before writing any manifest in a repair batch', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-dependency-batch-'))
    roots.push(root)
    const valid = { ...facts({ name: '@deepseek-ai/dsh-first' }), manifestPath: 'first.json' }
    const base = facts({ name: '@deepseek-ai/dsh-second' })
    const invalid: PackageDependencyFacts = {
      ...base,
      manifestPath: 'second.json',
      allSourceUses: new Map([...base.allSourceUses, ['undeclared', ['src/client/index.ts']]]),
    }
    const subjects = [valid, invalid]
    const originals = subjects.map(subject => ({ subject, content: `${JSON.stringify(subject.manifest)}\n` }))
    for (const { subject, content } of originals) writeFileSync(join(root, subject.manifestPath), content)
    const state = { facts: subjects, packages: [], policyViolations: [], workspaceNames: valid.workspaceNames }

    expect(fixPackageDependencies(root, { ...state, policyViolations: ['unclassified Host export'] })).toEqual([])
    expect(() => fixPackageDependencies(root, state)).toThrow(
      'second.json: cannot repair undeclared third-party dependency undeclared; declare its version range first',
    )
    for (const { subject, content } of originals) {
      expect(readFileSync(join(root, subject.manifestPath), 'utf8')).toBe(content)
      expect(`${JSON.stringify(subject.manifest)}\n`).toBe(content)
    }
  })

  it('moves browser-only third-party imports to development dependencies without changing their ranges', () => {
    const manifest: PackageDependencyManifest = {
      name: '@deepseek-ai/dsh-probe',
      dependencies: { '@deepseek-ai/dsh-runtime': 'workspace:*', external: '^1.2.3' },
      devDependencies: { [CORDIS]: 'workspace:~', '@deepseek-ai/dsh-types': 'workspace:*' },
      peerDependencies: { [CORDIS]: 'workspace:~' },
    }
    const base = facts(manifest)
    const subject: PackageDependencyFacts = {
      ...base,
      allSourceUses: new Map([...base.allSourceUses, ['external', ['packages/core/probe/src/client/index.ts']]]),
    }
    const state = { facts: [subject], packages: [], policyViolations: [], workspaceNames: subject.workspaceNames }

    expect(collectPackageDependencyViolations(state)).toEqual([
      'packages/core/probe/package.json: external (packages/core/probe/src/client/index.ts) '
      + 'must be devDependencies-only; found dependencies',
    ])
    repairPackageDependencyManifest(subject)
    expect(manifest.dependencies?.external).toBeUndefined()
    expect(manifest.devDependencies?.external).toBe('^1.2.3')
    expect(collectPackageDependencyViolations(state)).toEqual([])
    const repaired = structuredClone(manifest)
    repairPackageDependencyManifest(subject)
    expect(manifest).toEqual(repaired)
  })
})
