import { describe, expect, it } from 'vitest'
import { PACKAGE_DEPENDENCY_POLICY } from './package-dependency-policy.ts'
import {
  collectHostDependencyExportPolicyViolations,
  discoverPackageDependencyScope,
} from './verify-package-dependencies.ts'
import { hostRuntimeFixture, pkg, policy } from './verify-package-dependencies.fixtures.ts'

describe('package dependency scope', () => {
  it('keeps the measured Host relay roster explicit', () => {
    expect(PACKAGE_DEPENDENCY_POLICY.clientFaceExclude).toEqual([
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-api-workspace-controller',
    ])
    expect(PACKAGE_DEPENDENCY_POLICY.hostPackages).toEqual([
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-session',
    ])
    expect(PACKAGE_DEPENDENCY_POLICY.configurationOnlyDevDependencies).toEqual({
      '@deepseek-ai/dsh-client-locale': ['@deepseek-ai/dsh-api-remotes'],
      '@deepseek-ai/dsh-client-ui-conversation': [
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-ui-workspace',
      ],
      '@deepseek-ai/dsh-client-ui-model-selection': ['@deepseek-ai/dsh-client-ui-input-trigger'],
      '@deepseek-ai/dsh-client-ui-sidebar': ['@deepseek-ai/dsh-client-ui-workspace'],
      '@deepseek-ai/dsh-client-ui-subagent': ['@deepseek-ai/dsh-client-ui-input-trigger'],
      '@deepseek-ai/dsh-client-ui-theme': ['@deepseek-ai/dsh-api-remotes'],
      '@deepseek-ai/dsh-client-ui-tool': ['@deepseek-ai/dsh-api-remotes'],
    })
    expect(PACKAGE_DEPENDENCY_POLICY.duplicateSafePackages).toEqual([
      '@deepseek-ai/dsh-brand',
      '@deepseek-ai/dsh-lazy-require',
      '@deepseek-ai/dsh-typert-protocol',
      '@deepseek-ai/dsh-util-crypto',
      '@deepseek-ai/dsh-util-values',
    ])
    expect(PACKAGE_DEPENDENCY_POLICY.safeHostDependencyExports['@deepseek-ai/dsh-deque']).toEqual(['Deque'])
    expect(PACKAGE_DEPENDENCY_POLICY.safeHostDependencyExports['@deepseek-ai/schemastery']).toEqual(['default'])
    expect(PACKAGE_DEPENDENCY_POLICY.safeHostDependencyExports['@deepseek-ai/dsh-session/types']).toBeUndefined()
    expect(PACKAGE_DEPENDENCY_POLICY.safeHostDependencyExports['@deepseek-ai/dsh-typert-protocol']).toBeUndefined()
    expect(PACKAGE_DEPENDENCY_POLICY.peerRequiredHostExports['@deepseek-ai/dsh-scope']).toEqual([
      'carrierKeyOf', 'createScope', 'scopeOf', 'scopeTarget',
    ])
    expect(PACKAGE_DEPENDENCY_POLICY.peerRequiredHostExports['@deepseek-ai/dsh-typert-protocol']).toBeUndefined()
  })

  it('discovers the Client directory, dsh.client declarations, and configured Host packages', () => {
    const packages = [
      pkg('@f/static', 'packages/client/static/package.json'),
      pkg('@f/dynamic-client', 'packages/client/dynamic/package.json', { dsh: { client: {} } }),
      pkg('@f/dual', 'packages/api/dual/package.json', { dsh: { client: {} } }),
      pkg('@f/export-only', 'packages/api/export-only/package.json', { exports: { './client': './lib/client.js' } }),
      pkg('@f/forced-client', 'packages/api/forced/package.json'),
      pkg('@f/excluded', 'packages/api/excluded/package.json', { dsh: { client: {} } }),
      pkg('@f/host', 'packages/core/host/package.json'),
    ]

    const found = discoverPackageDependencyScope(packages, policy({
      clientFaceInclude: ['@f/forced-client'],
      clientFaceExclude: ['@f/excluded'],
      hostPackages: ['@f/host'],
    }))

    expect(found.violations).toEqual([])
    expect(found.selected.map(item => [item.name, item.role])).toEqual([
      ['@f/dual', 'client-host'],
      ['@f/forced-client', 'client-host'],
      ['@f/dynamic-client', 'client-host'],
      ['@f/static', 'client-only'],
      ['@f/host', 'configured-host'],
    ])
  })

  it('rejects stale, redundant, overlapping, and unknown configuration', () => {
    const packages = [
      pkg('@f/client', 'packages/client/client/package.json'),
      pkg('@f/dual', 'packages/api/dual/package.json', { dsh: { client: {} } }),
      pkg('@f/host', 'packages/core/host/package.json'),
    ]
    const found = discoverPackageDependencyScope(packages, policy({
      clientFaceInclude: ['@f/dual', '@f/missing', '@f/host'],
      clientFaceExclude: ['@f/client', '@f/host', '@f/missing'],
      hostPackages: ['@f/dual'],
    }))

    expect(found.violations).toEqual(expect.arrayContaining([
      expect.stringContaining('clientFaceInclude redundantly names automatically discovered package @f/dual'),
      expect.stringContaining('@f/host appears in both clientFaceInclude and clientFaceExclude'),
      expect.stringContaining('clientFaceExclude cannot exempt packages/client package @f/client'),
      expect.stringContaining('clientFaceExclude names @f/host, which declares no dsh.client entry'),
      expect.stringContaining('hostPackages redundantly names Client-faced package @f/dual'),
      expect.stringContaining('unknown release package @f/missing'),
    ]))
  })

  it('rejects stale, duplicate, and unbounded safe Host export entries', () => {
    const { provider, workspaceNames, consumerFacts } = hostRuntimeFixture()

    expect(collectHostDependencyExportPolicyViolations(
      [consumerFacts],
      workspaceNames,
      {
        safeHostDependencyExports: {
          [`${provider.name}/api`]: ['safeValue', 'safeValue', '*', 'staleValue'],
        },
        peerRequiredHostExports: {
          [`${provider.name}/api`]: ['safeValue'],
        },
      },
    )).toEqual(expect.arrayContaining([
      expect.stringContaining('export safeValue more than once'),
      expect.stringContaining('cannot classify unbounded'),
      expect.stringContaining('unused @f/provider/api export staleValue'),
      expect.stringContaining('appears in both Host export classifications'),
    ]))
  })

  it('applies a duplicate-safe package classification to its subpaths', () => {
    const { provider, workspaceNames, consumerFacts } = hostRuntimeFixture()

    expect(collectHostDependencyExportPolicyViolations(
      [consumerFacts],
      workspaceNames,
      {
        duplicateSafePackages: [provider.name],
        safeHostDependencyExports: {},
        peerRequiredHostExports: {},
      },
    )).toEqual([])
    expect(collectHostDependencyExportPolicyViolations(
      [consumerFacts],
      workspaceNames,
      {
        duplicateSafePackages: [provider.name],
        safeHostDependencyExports: { [`${provider.name}/api`]: ['safeValue'] },
        peerRequiredHostExports: {},
      },
    )).toContain(`safeHostDependencyExports redundantly classifies duplicate-install-safe package ${provider.name}/api`)
  })
})
