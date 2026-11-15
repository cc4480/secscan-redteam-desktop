import { describe, expect, it } from 'vitest'
import {
  collectHostDependencyExportPolicyViolations,
  collectPackageDependencyViolations,
  fixPackageDependencies,
  formatManagedRuntimeDependencies,
  formatPeerRequiredRuntimeDependencies,
  repairPackageDependencyManifest,
  type PackageDependencyFacts,
  type PackageDependencyManifest,
} from './verify-package-dependencies.ts'
import { CORDIS, facts } from './verify-package-dependencies.fixtures.ts'

describe('dependency sections', () => {
  it('does not leak repository configuration into captured dependency facts', () => {
    const manifest: PackageDependencyManifest = {
      name: '@deepseek-ai/dsh-client-locale',
      dependencies: { '@deepseek-ai/dsh-runtime': 'workspace:*' },
      devDependencies: { [CORDIS]: 'workspace:~', '@deepseek-ai/dsh-types': 'workspace:*' },
      peerDependencies: { [CORDIS]: 'workspace:~' },
    }
    const base = facts(manifest)
    const subject: PackageDependencyFacts = {
      ...base,
      workspaceNames: new Set([...base.workspaceNames, '@deepseek-ai/dsh-api-remotes']),
    }

    expect(collectPackageDependencyViolations({
      facts: [subject], packages: [], policyViolations: [], workspaceNames: subject.workspaceNames,
    })).toEqual([])
  })

  it('requires non-workspace Host runtime imports in dependencies', () => {
    const manifest: PackageDependencyManifest = {
      name: '@deepseek-ai/dsh-probe',
      dependencies: { '@deepseek-ai/dsh-runtime': 'workspace:*' },
      devDependencies: { [CORDIS]: 'workspace:~', '@deepseek-ai/dsh-types': 'workspace:*', external: '^1.0.0' },
      peerDependencies: { [CORDIS]: 'workspace:~' },
    }
    const subject: PackageDependencyFacts = {
      ...facts(manifest),
      hostRuntimeSourceUses: new Map([
        ['@deepseek-ai/dsh-runtime', ['packages/core/probe/src/index.ts']],
        ['external', ['packages/core/probe/src/index.ts']],
      ]),
      allSourceUses: new Map([
        ...facts(manifest).allSourceUses,
        ['external', ['packages/core/probe/src/client/index.ts']],
      ]),
    }
    const state = {
      facts: [subject], packages: [], policyViolations: [], workspaceNames: subject.workspaceNames,
    }

    expect(collectPackageDependencyViolations(state)).toContain(
      'packages/core/probe/package.json: external (packages/core/probe/src/client/index.ts, packages/core/probe/src/index.ts) '
      + 'must be dependencies-only; found devDependencies',
    )
    repairPackageDependencyManifest(subject)
    expect(manifest.dependencies?.external).toBe('^1.0.0')
    expect(manifest.devDependencies?.external).toBeUndefined()
    const repaired = structuredClone(manifest)
    repairPackageDependencyManifest(subject)
    expect(manifest).toEqual(repaired)

    delete manifest.dependencies?.external
    expect(collectPackageDependencyViolations(state)).toContain(
      'packages/core/probe/package.json: external (packages/core/probe/src/client/index.ts, packages/core/probe/src/index.ts) '
      + 'must be dependencies-only; found no dependency section',
    )
  })

  it('accepts Host dependencies, development-only inputs, and shared Cordis', () => {
    const manifest: PackageDependencyManifest = {
      name: '@deepseek-ai/dsh-probe',
      dependencies: {
        '@deepseek-ai/dsh-runtime': 'workspace:*',
        '@deepseek-ai/schemastery': 'workspace:~',
        external: '^1.0.0',
      },
      devDependencies: {
        '@deepseek-ai/dsh-types': 'workspace:*',
        [CORDIS]: 'workspace:~',
      },
      peerDependencies: { [CORDIS]: 'workspace:~' },
    }
    expect(collectPackageDependencyViolations({
      facts: [facts(manifest)], packages: [], policyViolations: [], workspaceNames: facts(manifest).workspaceNames,
    })).toEqual([])
  })

  it('lists managed Host runtime dependencies for fix review', () => {
    const subject = facts({ name: '@deepseek-ai/dsh-probe' })
    expect(formatManagedRuntimeDependencies({
      facts: [subject], packages: [], policyViolations: [], workspaceNames: subject.workspaceNames,
    })).toEqual([
      'verify-package-dependencies: 1 managed Host runtime edge(s) remain in dependencies across 1 package(s):',
      '  @deepseek-ai/dsh-probe -> @deepseek-ai/dsh-runtime: @deepseek-ai/dsh-runtime#runtimeValue',
    ])
  })

  it('reports an unapproved Host runtime export without rewriting its dependency section', () => {
    const manifest: PackageDependencyManifest = {
      name: '@deepseek-ai/dsh-probe',
      dependencies: { '@deepseek-ai/dsh-runtime': 'workspace:*' },
      devDependencies: { [CORDIS]: 'workspace:~', '@deepseek-ai/dsh-types': 'workspace:*' },
      peerDependencies: { [CORDIS]: 'workspace:~' },
    }
    const subject = facts(manifest)
    const safetyViolations = collectHostDependencyExportPolicyViolations(
      [subject],
      subject.workspaceNames,
      { safeHostDependencyExports: {}, peerRequiredHostExports: {} },
    )
    const state = {
      facts: [subject], packages: [], policyViolations: safetyViolations, workspaceNames: subject.workspaceNames,
    }

    expect(safetyViolations).toEqual([
      'packages/core/probe/src/index.ts:1:10: @deepseek-ai/dsh-runtime#runtimeValue is not classified as '
      + 'safe or peer-required — import { runtimeValue } from \'@deepseek-ai/dsh-runtime\'',
    ])
    expect(fixPackageDependencies('/unused', state)).toEqual([])
    expect(manifest.dependencies).toEqual({ '@deepseek-ai/dsh-runtime': 'workspace:*' })
  })

  it('keeps an edge as a peer when one imported export requires shared identity', () => {
    const manifest: PackageDependencyManifest = {
      name: '@deepseek-ai/dsh-probe',
      dependencies: { '@deepseek-ai/dsh-runtime': 'workspace:*' },
      devDependencies: { [CORDIS]: 'workspace:~', '@deepseek-ai/dsh-types': 'workspace:*' },
      peerDependencies: { [CORDIS]: 'workspace:~' },
    }
    const subject: PackageDependencyFacts = {
      ...facts(manifest),
      peerRequiredHostDependencies: new Set(['@deepseek-ai/dsh-runtime']),
    }
    expect(collectHostDependencyExportPolicyViolations(
      [subject],
      subject.workspaceNames,
      {
        safeHostDependencyExports: {},
        peerRequiredHostExports: {
          '@deepseek-ai/dsh-runtime': ['runtimeValue'],
        },
      },
    )).toEqual([])

    repairPackageDependencyManifest(subject)
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.peerDependencies).toMatchObject({
      [CORDIS]: 'workspace:~',
      '@deepseek-ai/dsh-runtime': 'workspace:*',
    })
    expect(manifest.devDependencies).toMatchObject({
      [CORDIS]: 'workspace:~',
      '@deepseek-ai/dsh-runtime': 'workspace:*',
    })
    expect(formatPeerRequiredRuntimeDependencies({
      facts: [subject], packages: [], policyViolations: [], workspaceNames: subject.workspaceNames,
    })).toEqual([
      'verify-package-dependencies: 1 Host runtime edge(s) remain in peerDependencies because their exports require shared identity across 1 package(s):',
      '  @deepseek-ai/dsh-probe -> @deepseek-ai/dsh-runtime: @deepseek-ai/dsh-runtime#runtimeValue',
    ])
  })
})
