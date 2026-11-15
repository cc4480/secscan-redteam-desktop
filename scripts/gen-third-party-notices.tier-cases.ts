/** Runtime-versus-development tiering of workspace dependency declarations. */

import { describe, expect, it } from 'vitest'
import {
  CLAUDE_AGENT_SDK_PACKAGE,
  assertRuntimeLicenses,
  isPermissive,
  type Manifest,
  tierExternalDeps,
} from './gen-third-party-notices.ts'

/** Build the (manifests, names) pair `tierExternalDeps` consumes. */
function workspace(entries: Record<string, Manifest>): { manifests: Map<string, Manifest>; names: Set<string> } {
  const manifests = new Map(Object.entries(entries))
  const names = new Set<string>()
  for (const manifest of manifests.values()) {
    if (manifest.name !== undefined) names.add(manifest.name)
  }
  return { manifests, names }
}

describe('tierExternalDeps', () => {
  it('limits the LibreOffice exception to its reviewed package identity and MPL terms', () => {
    for (const name of [
      '@deepseek-ai/libreoffice-kit', '@deepseek-ai/libreoffice-kit-wasm',
      '@deepseek-ai/libreoffice-kit-darwin-arm64', '@deepseek-ai/libreoffice-kit-darwin-x64',
      '@deepseek-ai/libreoffice-kit-win32-arm64', '@deepseek-ai/libreoffice-kit-win32-x64',
    ]) {
      expect(() => { assertRuntimeLicenses([{ name, license: 'MPL-2.0' }]) }).not.toThrow()
      expect(() => { assertRuntimeLicenses([{ name, license: 'GPL-3.0-only' }]) }).toThrow(name)
    }
    for (const dependency of [
      { name: 'unrelated-library', license: 'MPL-2.0' },
      { name: '@deepseek-ai/dsh-libreoffice-kit', license: 'MPL-2.0' },
      { name: '@deepseek-ai/libreoffice-kit-unreviewed', license: 'MPL-2.0' },
      { name: '@deepseek-ai/libreoffice-kit', license: 'GPL-3.0-only' },
      { name: '@deepseek-ai/libreoffice-kit', license: 'UNKNOWN' },
    ]) {
      expect(() => { assertRuntimeLicenses([dependency]) }).toThrow(`${dependency.name} (${dependency.license})`)
    }
    expect(isPermissive('MPL-2.0')).toBe(false)
  })

  it('keeps license rejection active when a browser library is declared for development', () => {
    const { manifests, names } = workspace({
      'packages/client/ui/package.json': { devDependencies: { 'browser-lib': '^1', 'test-tool': '^1' } },
    })
    const tiers = tierExternalDeps(manifests, names, new Set(['browser-lib']))
    const dependencies = [{ name: 'browser-lib', license: 'GPL-3.0-only' }, { name: 'test-tool', license: 'GPL-3.0-only' }]
      .filter(dep => tiers.get(dep.name))
    expect(dependencies.map(dep => dep.name)).toEqual(['browser-lib'])
    expect(() => { assertRuntimeLicenses(dependencies) }).toThrow('browser-lib (GPL-3.0-only)')
    expect(() => { assertRuntimeLicenses([{ name: 'browser-lib', license: 'MIT' }]) }).not.toThrow()
    expect(() => { assertRuntimeLicenses([{ name: CLAUDE_AGENT_SDK_PACKAGE, license: 'SEE LICENSE IN README.md' }]) })
      .not.toThrow()
  })

  it('keeps browser-bundled development dependencies in runtime disclosures', () => {
    const { manifests, names } = workspace({
      'packages/client/ui/package.json': {
        name: '@fixture/ui', devDependencies: { react: '^18', 'browser-lib': '^1', 'type-only': '^1' },
      },
    })
    expect(tierExternalDeps(manifests, names, new Set(['react', 'browser-lib']))).toEqual(new Map([
      ['tsx', true], ['react', true], ['browser-lib', true], ['type-only', false],
    ]))
  })

  it('rejects a browser library missing from the disclosed declarations', () => {
    const { manifests, names } = workspace({})
    expect(() => tierExternalDeps(manifests, names, new Set(['missing-lib'])))
      .toThrow('browser package missing-lib has no workspace dependency declaration')
  })

  it('tiers by declaring area, not by the declaring section name', () => {
    const { manifests, names } = workspace({
      // Root tooling and test infrastructure never ship, whichever section declares them.
      'package.json': { dependencies: { 'root-runtime-looking': '^1' }, devDependencies: { 'lint-tool': '^1' } },
      'packages/test-support/loader-smoke/package.json': { name: '@deepseek-ai/dsh-loader-smoke', dependencies: { 'smoke-helper': '^1' } },
      'packages/test-support/client-runtime/package.json': { name: '@deepseek-ai/dsh-client-test-runtime', dependencies: { 'test-lib': '^1' } },
      'website/package.json': { devDependencies: { 'site-tool': '^1' } },
      // A plugin package's runtime dependency ships even when no app mounts it by default.
      'packages/mcp/mcp-client/package.json': { name: '@deepseek-ai/dsh-mcp-client', dependencies: { 'protocol-sdk': '^1' }, devDependencies: { 'protocol-fixture-server': '^1' } },
      'apps/cli/package.json': { name: '@deepseek-ai/dsh-cli', dependencies: { 'cli-lib': '^1', '@deepseek-ai/dsh-mcp-client': 'workspace:^' } },
    })

    expect(tierExternalDeps(manifests, names)).toEqual(new Map([
      ['tsx', true],
      ['root-runtime-looking', false],
      ['lint-tool', false],
      ['smoke-helper', false],
      ['test-lib', false],
      ['site-tool', false],
      ['protocol-sdk', true],
      ['protocol-fixture-server', false],
      ['cli-lib', true],
    ]))
  })

  it('keeps a package runtime when any shipping area declares it, and excludes workspace links', () => {
    const { manifests, names } = workspace({
      'package.json': { devDependencies: { shared: '^1' } },
      'packages/interaction/tui/package.json': { name: '@deepseek-ai/dsh-tui', dependencies: { shared: '^1', '@deepseek-ai/dsh-cli': 'workspace:^' } },
      'apps/cli/package.json': { name: '@deepseek-ai/dsh-cli' },
    })

    expect(tierExternalDeps(manifests, names).get('shared')).toBe(true)
    expect(tierExternalDeps(manifests, names).has('@deepseek-ai/dsh-cli')).toBe(false)
  })
})
