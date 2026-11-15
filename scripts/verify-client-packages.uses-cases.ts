/** The source package uses cases: which specifiers a source module is read as requesting. */

import { describe, expect, it } from 'vitest'
import {
  collectLocalSourceSpecifiers,
  collectRuntimeLocalSourceSpecifiers,
  collectRuntimeSourcePackageUses,
  collectRuntimeSourceSpecifiers,
  collectSourcePackageUses,
} from './verify-client-packages.ts'

describe('source package uses', () => {
  it('includes root-relative runtime requests only when explicitly requested', () => {
    const source = [
      "import './local.ts'",
      "import '/src/value.ts'",
      "export * from '/src/export.ts'",
      "const load = () => import('/src/lazy.ts')",
      "const legacy = require('/src/legacy.ts')",
      "import type { A } from '/src/import-type.ts'",
      "import { type B } from '/src/import-type-only.ts'",
      "export type { A } from '/src/export-type.ts'",
      "export { type B } from '/src/export-type-only.ts'",
    ].join('\n')
    expect([...collectRuntimeLocalSourceSpecifiers('feature.ts', source)]).toEqual(['./local.ts'])
    expect([...collectRuntimeLocalSourceSpecifiers('feature.ts', source, true)]).toEqual([
      './local.ts', '/src/value.ts', '/src/export.ts', '/src/lazy.ts', '/src/legacy.ts',
    ])
  })

  it('counts type imports, module augmentations, dynamic imports, and JSX', () => {
    const uses = collectSourcePackageUses('feature.tsx', [
      "import type { A } from '@deepseek-ai/dsh-a/subpath'",
      "declare module '@deepseek-ai/dsh-client-ui-slots' {}",
      "const load = () => import('@deepseek-ai/dsh-b/remote')",
      'export const view = <div />',
      "export type { Local } from './local.ts'",
    ].join('\n'))

    expect([...uses].sort()).toEqual([
      '@deepseek-ai/dsh-a',
      '@deepseek-ai/dsh-b',
      '@deepseek-ai/dsh-client-ui-slots',
      'react',
    ])
    expect([...collectRuntimeSourcePackageUses('feature.tsx', [
      "import type { A } from '@deepseek-ai/dsh-a/subpath'",
      "declare module '@deepseek-ai/dsh-client-ui-slots' {}",
      "const load = () => import('@deepseek-ai/dsh-b')",
      'export const view = <div />',
    ].join('\n'))].sort()).toEqual([
      '@deepseek-ai/dsh-b',
      'react',
    ])
    expect([...collectRuntimeSourceSpecifiers('feature.tsx', [
      "import type { A } from '@deepseek-ai/dsh-a/subpath'",
      "const load = () => import('@deepseek-ai/dsh-b/remote')",
      'export const view = <div />',
    ].join('\n'))].sort()).toEqual([
      '@deepseek-ai/dsh-b/remote',
      'react',
    ])
    expect([...collectLocalSourceSpecifiers('feature.ts', [
      "import type { A } from './types.ts'",
      "export { value } from './value.ts'",
      "const load = () => import('./lazy.ts')",
      "const legacy = require('./legacy.ts')",
      "declare module './augmentation.ts' {}",
      "import '@deepseek-ai/dsh-a'",
    ].join('\n'))].sort()).toEqual([
      './lazy.ts',
      './legacy.ts',
      './types.ts',
      './value.ts',
    ])
  })
})
