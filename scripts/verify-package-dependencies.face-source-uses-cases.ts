import { afterEach, describe, expect, it } from 'vitest'
import {
  expectedPackageDependencies,
  repairPackageDependencyManifest,
} from './verify-package-dependencies.ts'
import { CORDIS, cleanupRoots, sourceFacts } from './verify-package-dependencies.fixtures.ts'

afterEach(cleanupRoots)

describe('face-aware source classification', () => {
  it('counts browser imports, JSX, type-only references, and augmentations as development inputs', () => {
    const subject = sourceFacts({
      'src/index.ts': [
        "import { readFile } from 'node:fs'",
        "import { join } from 'path'",
        "import type { HostType } from 'host-types'",
        "import { type MixedType } from 'mixed-types'",
        "import type { Hidden } from './type-helper.ts'",
      ].join('\n'),
      'src/type-helper.ts': "import { hidden } from 'hidden-value'; export type Hidden = typeof hidden",
      'src/client/index.tsx': [
        "import { browser } from '@browser/kit/subpath'",
        "import 'react-dom/client'",
        "import '#local'",
        "import 'https://example.test/browser.js'",
        'export const view = <div />',
      ].join('\n'),
      'src/client/augmentation.d.ts': [
        "declare module 'augmented' { interface Extra {} }",
        "declare module '*.css' {}",
        "declare module '*.module.css' {}",
      ].join('\n'),
    })

    expect([...subject.hostRuntimeSourceUses]).toEqual([])
    expect([...expectedPackageDependencies(subject)].map(([name, rule]) => [name, rule.section]).sort()).toEqual([
      ['@browser/kit', 'devDependencies'],
      [CORDIS, 'peer-dev'],
      ['augmented', 'devDependencies'],
      ['hidden-value', 'devDependencies'],
      ['host-types', 'devDependencies'],
      ['mixed-types', 'devDependencies'],
      ['react', 'devDependencies'],
      ['react-dom', 'devDependencies'],
    ])
  })

  it.each(['client-host', 'configured-host'] as const)('retains Host and shared third-party values in dependencies for %s', (role) => {
    const subject = sourceFacts({
      'src/index.ts': "import 'host-only'; export { shared } from './nested.ts'",
      'src/nested.ts': "export { shared } from 'shared-runtime'",
      'src/client/index.ts': "import 'browser-only'; import 'shared-runtime'",
    }, {}, role)

    const expected = expectedPackageDependencies(subject)
    expect(expected.get('browser-only')?.section).toBe('devDependencies')
    expect(expected.get('host-only')?.section).toBe('dependencies')
    expect(expected.get('shared-runtime')?.section).toBe('dependencies')
  })

  it('uses declared DefinitelyTyped providers only for erased source references', () => {
    const subject = sourceFacts({
      'src/index.ts': "import type { ReactNode } from 'react'",
      'src/client/index.ts': "import type { Root } from 'mdast'; import type { Kind } from '@scope/types'",
    }, {
      dependencies: { '@types/mdast': '^4.0.0' },
      devDependencies: { '@types/react': '^18.0.0', '@types/scope__types': '^1.0.0' },
    })

    expect([...subject.allSourceUses.keys()].sort()).toEqual(['@types/mdast', '@types/react', '@types/scope__types'])
    expect([...subject.hostRuntimeSourceUses]).toEqual([])
    repairPackageDependencyManifest(subject)
    expect(subject.manifest.devDependencies?.['@types/mdast']).toBe('^4.0.0')
    expect(subject.manifest.dependencies?.['@types/mdast']).toBeUndefined()
    expect(subject.manifest.devDependencies?.mdast).toBeUndefined()
  })

  it.each(["import 'runtime-library'", 'export const view = <div />'])('does not let type providers satisfy runtime imports or JSX: %s', (source) => {
    const name = source.includes('<div') ? 'react' : 'runtime-library'
    const subject = sourceFacts({
      'src/index.ts': 'export function apply() {}',
      'src/client/index.tsx': source,
    }, { devDependencies: { [`@types/${name}`]: '^1.0.0' } })

    expect(subject.allSourceUses.has(name)).toBe(true)
    expect(() => { repairPackageDependencyManifest(subject) }).toThrow(`undeclared third-party dependency ${name}`)
  })
})
