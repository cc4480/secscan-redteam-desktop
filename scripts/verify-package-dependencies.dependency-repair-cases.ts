import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectPackageDependencyViolations,
  fixPackageDependencies,
  repairPackageDependencyManifest,
  type PackageDependencyManifest,
} from './verify-package-dependencies.ts'
import { CORDIS, cleanupRoots, facts, roots } from './verify-package-dependencies.fixtures.ts'

afterEach(cleanupRoots)

describe('dependency sections', () => {
  it('reports wrong sections, workspace ranges, and stale peer metadata', () => {
    const manifest: PackageDependencyManifest = {
      name: '@deepseek-ai/dsh-probe',
      dependencies: { '@deepseek-ai/dsh-types': 'workspace:^' },
      devDependencies: { [CORDIS]: 'workspace:~', '@deepseek-ai/dsh-runtime': 'workspace:*' },
      peerDependencies: { [CORDIS]: 'workspace:*', '@deepseek-ai/dsh-runtime': 'workspace:*' },
      peerDependenciesMeta: { '@deepseek-ai/dsh-missing': { optional: true } },
    }
    const state = {
      facts: [facts(manifest)], packages: [], policyViolations: [], workspaceNames: facts(manifest).workspaceNames,
    }
    const violations = collectPackageDependencyViolations(state)
    expect(violations).toEqual(expect.arrayContaining([
      expect.stringContaining('@deepseek-ai/dsh-runtime'),
      expect.stringContaining('@deepseek-ai/dsh-types'),
      expect.stringContaining(`${CORDIS} must be matching peerDependencies + devDependencies`),
      expect.stringContaining('dependencies.@deepseek-ai/dsh-types must use workspace:*'),
      expect.stringContaining('peerDependenciesMeta.@deepseek-ai/dsh-missing has no matching'),
    ]))
  })

  it('repairs owned relationships without changing unrelated dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-package-dependencies-'))
    roots.push(root)
    const manifestPath = 'package.json'
    const manifest: PackageDependencyManifest = {
      name: '@deepseek-ai/dsh-probe',
      dependencies: { '@deepseek-ai/schemastery': 'workspace:*', external: '^1.0.0' },
      devDependencies: { [CORDIS]: 'workspace:~', '@deepseek-ai/dsh-runtime': 'workspace:*' },
      peerDependencies: {
        [CORDIS]: 'workspace:~',
        '@deepseek-ai/dsh-runtime': 'workspace:*',
        '@deepseek-ai/dsh-stale': 'workspace:*',
      },
      peerDependenciesMeta: { '@deepseek-ai/dsh-stale': { optional: true } },
    }
    writeFileSync(join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
    const subject = { ...facts(manifest), manifestPath }
    const state = { facts: [subject], packages: [], policyViolations: [], workspaceNames: subject.workspaceNames }

    expect(fixPackageDependencies(root, state)).toEqual([manifestPath])
    const fixed = JSON.parse(readFileSync(join(root, manifestPath), 'utf8')) as PackageDependencyManifest
    expect(fixed.dependencies).toEqual({
      '@deepseek-ai/schemastery': 'workspace:~',
      external: '^1.0.0',
      '@deepseek-ai/dsh-runtime': 'workspace:*',
    })
    expect(fixed.devDependencies).toEqual({
      [CORDIS]: 'workspace:~',
      '@deepseek-ai/dsh-types': 'workspace:*',
      '@deepseek-ai/dsh-stale': 'workspace:*',
    })
    expect(fixed.peerDependencies).toEqual({ [CORDIS]: 'workspace:~' })
    expect(fixed.peerDependenciesMeta).toBeUndefined()
  })

  it('repairs an in-memory manifest for benchmark simulation', () => {
    const manifest: PackageDependencyManifest = {
      name: '@deepseek-ai/dsh-probe',
      peerDependencies: { [CORDIS]: 'workspace:~', '@deepseek-ai/dsh-runtime': 'workspace:*' },
      devDependencies: { [CORDIS]: 'workspace:~', '@deepseek-ai/dsh-runtime': 'workspace:*' },
    }
    repairPackageDependencyManifest(facts(manifest))
    expect(manifest.dependencies).toEqual({ '@deepseek-ai/dsh-runtime': 'workspace:*' })
    expect(manifest.peerDependencies).toEqual({ [CORDIS]: 'workspace:~' })
  })
})
