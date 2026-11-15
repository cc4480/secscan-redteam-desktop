import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectRuntimeSourceExportUses,
  expectedPackageDependencies,
  readPackageDependencyFacts,
} from './verify-package-dependencies.ts'
import {
  CORDIS,
  cleanupRoots,
  pkg,
  policy,
  roots,
  sourceFacts,
} from './verify-package-dependencies.fixtures.ts'

afterEach(cleanupRoots)

describe('face-aware source classification', () => {
  it('does not treat static browser library entries as Host modules', () => {
    const subject = sourceFacts({
      'src/index.tsx': "import 'static-input'; export const view = <div />",
      'src/invariant.ts': "import 'browser-companion'",
    }, {
      exports: {
        '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
        './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' },
      },
    }, 'client-only')

    expect([...subject.hostRuntimeSourceUses]).toEqual([])
    for (const name of ['static-input', 'react', 'browser-companion']) {
      expect(expectedPackageDependencies(subject).get(name)?.section).toBe('devDependencies')
    }
  })

  it('scans published Node companions, conditional entries, and emitted-tree subpaths from source', () => {
    const subject = sourceFacts({
      'src/index.ts': 'export function apply() {}',
      'src/invariant.ts': "import 'invariant-runtime'; import type { Kind } from 'invariant-types'",
      'src/node/helper.ts': "export { helper } from 'node-helper'",
      'src/node.mts': "import 'node-import'",
      'src/node.cts': "require('node-require')",
      'src/emitted.tsx': 'export const view = <div />',
      'src/worker/one.ts': "import 'worker-one'",
      'src/worker/two.ts': "import('worker-two')",
      'src/client/index.ts': "import 'browser-only'",
      'src/types-only.ts': "import 'type-export-only'",
    }, {
      exports: {
        '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
        './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' },
        './renamed': { types: './lib/types/node/helper.d.ts', default: './lib/node-bundle.js' },
        './conditional': { browser: './lib/browser.js', node: { import: './lib/node.mjs', require: './lib/node.cjs' } },
        './emitted': { types: './lib/types/emitted.d.ts', default: './lib/types/emitted.js' },
        './worker/*': './lib/worker/*.js',
        './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
        './client/extra': './lib/missing-browser.js',
        './types-only': { types: './lib/types/types-only.d.ts' },
        './src/*': './src/*',
        './package.json': './package.json',
        './disabled': null,
      },
    })

    expect([...subject.hostRuntimeSourceUses.keys()].sort()).toEqual([
      'invariant-runtime', 'node-helper', 'node-import', 'node-require', 'react', 'worker-one', 'worker-two',
    ])
    const expected = expectedPackageDependencies(subject)
    for (const name of subject.hostRuntimeSourceUses.keys()) expect(expected.get(name)?.section).toBe('dependencies')
    for (const name of ['browser-only', 'invariant-types', 'type-export-only']) {
      expect(expected.get(name)?.section).toBe('devDependencies')
    }
  })

  it.each([
    './lib/missing.js',
    { types: './lib/types/missing.d.ts', default: './lib/renamed.js' },
    ['./lib/missing.cjs'],
    './lib/missing/*.js',
  ])('rejects a published Node entry with no matching source: %j', (target) => {
    expect(() => sourceFacts({ 'src/index.ts': 'export function apply() {}' }, {
      exports: { './node': target },
    })).toThrow('Host export ./node has no source entry')
  })

  it('rejects a Node export outside the source mapping', () => {
    expect(() => sourceFacts({ 'src/index.ts': 'export function apply() {}' }, {
      exports: { './node': './other/node.js' },
    })).toThrow('Host export ./node cannot map ./other/node.js to a source entry')
  })

  it('fails when a managed Host package has no Host entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-package-missing-host-'))
    roots.push(root)
    const subject = pkg('@f/host', 'packages/g/host/package.json')

    expect(() => readPackageDependencyFacts(root, subject, 'configured-host', new Set([subject.name])))
      .toThrow('packages/g/host/package.json: Host runtime entry packages/g/host/src/index.ts does not exist')
  })

  it('counts Host values as dependencies and Client values as development inputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-package-faces-'))
    roots.push(root)
    const subject = pkg('@f/dual', 'packages/g/dual/package.json', {
      dsh: { client: { inject: ['@f/injected'] } },
    })
    const files = {
      'packages/g/dual/src/index.ts': [
        "import { value } from '@f/runtime'",
        "import type { Shared } from '@f/types'",
        "import type { Hidden } from './types.ts'",
        "export { nested } from './nested.ts'",
      ].join('\n'),
      'packages/g/dual/src/nested.ts': "export { nested } from '@f/nested'",
      'packages/g/dual/src/types.ts': "import { hidden } from '@f/hidden'; export type Hidden = typeof hidden",
      'packages/g/dual/src/client/index.ts': "import { browser } from '@f/browser'",
    }
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), source)
    }
    const found = readPackageDependencyFacts(root, subject, 'client-host', new Set([
      CORDIS, '@f/runtime', '@f/types', '@f/nested', '@f/hidden', '@f/browser', '@f/injected',
    ]), policy({
      configurationOnlyDevDependencies: { '@f/dual': ['@f/injected'] },
    }))

    expect([...found.hostRuntimeSourceUses.keys()].sort()).toEqual(['@f/nested', '@f/runtime'])
    expect([...found.configurationOnlyDevDependencies]).toEqual(['@f/injected'])
    expect(found.hostRuntimeExportUses).toEqual([
      {
        packageName: '@f/nested',
        specifier: '@f/nested',
        exportName: 'nested',
        sourcePath: 'packages/g/dual/src/nested.ts',
        line: 1,
        column: 10,
        sourceLine: "export { nested } from '@f/nested'",
      },
      {
        packageName: '@f/runtime',
        specifier: '@f/runtime',
        exportName: 'value',
        sourcePath: 'packages/g/dual/src/index.ts',
        line: 1,
        column: 10,
        sourceLine: "import { value } from '@f/runtime'",
      },
    ])
    expect([...found.allSourceUses.keys()].sort()).toEqual([
      '@f/browser', '@f/hidden', '@f/nested', '@f/runtime', '@f/types',
    ])
  })

  it('identifies exact runtime exports without treating type imports as values', () => {
    const source = [
      "import defaultValue, { value as local, type Kind } from '@f/root'",
      "import * as namespace from '@f/namespace'",
      "import '@f/effect'",
      "import type { TypeOnly } from '@f/types'",
      "export { source as renamed, type SourceType } from '@f/reexport'",
      "export * from '@f/star'",
      "void import('@f/dynamic')",
      "void require('@f/required')",
      "import { createLazyRequire as lazy } from '@deepseek-ai/dsh-lazy-require'",
      "import * as lazyModule from '@deepseek-ai/dsh-lazy-require'",
      "void lazy('@f/lazy', import.meta.url)",
      "void lazyModule.createLazyRequire('@f/lazy-namespace', import.meta.url)",
      'void defaultValue; void local; void namespace',
    ].join('\n')
    const uses = collectRuntimeSourceExportUses('probe.ts', source)
    expect(uses.map(({ specifier, exportName }) => ({ specifier, exportName }))).toEqual([
      { specifier: '@deepseek-ai/dsh-lazy-require', exportName: '*' },
      { specifier: '@deepseek-ai/dsh-lazy-require', exportName: 'createLazyRequire' },
      { specifier: '@f/dynamic', exportName: '*' },
      { specifier: '@f/effect', exportName: '(side effect)' },
      { specifier: '@f/lazy', exportName: '*' },
      { specifier: '@f/lazy-namespace', exportName: '*' },
      { specifier: '@f/namespace', exportName: '*' },
      { specifier: '@f/reexport', exportName: 'source' },
      { specifier: '@f/required', exportName: '*' },
      { specifier: '@f/root', exportName: 'default' },
      { specifier: '@f/root', exportName: 'value' },
      { specifier: '@f/star', exportName: '*' },
    ])
    expect(uses.find(use => use.specifier === '@f/root' && use.exportName === 'value')).toMatchObject({
      line: 1,
      column: 24,
      sourceLine: "import defaultValue, { value as local, type Kind } from '@f/root'",
    })
  })
})
