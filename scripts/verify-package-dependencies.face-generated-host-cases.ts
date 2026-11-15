import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectPackageDependencyViolations,
  expectedPackageDependencies,
  readPackageDependencyFacts,
  readPackageDependencyState,
  repairPackageDependencyManifest,
} from './verify-package-dependencies.ts'
import {
  cleanupRoots,
  generatedHostFixture,
  pkg,
  policy,
} from './verify-package-dependencies.fixtures.ts'

afterEach(cleanupRoots)

describe('face-aware source classification', () => {
  it('keeps generated Host schema imports in dependencies without reading or writing lib', () => {
    const { root, manifestPath, source } = generatedHostFixture('schema')
    const before = readFileSync(join(root, manifestPath), 'utf8')
    const state = readPackageDependencyState(root, policy())
    const subject = state.facts[0]
    if (subject === undefined) throw new Error('generated Host fixture was not classified')

    expect(subject.allSourceUses.has('zod')).toBe(false)
    expect(subject.hostRuntimeExportUses).toContainEqual(expect.objectContaining({
      packageName: 'zod', specifier: 'zod', exportName: 'z',
      sourcePath: 'packages/client/probe/lib/typert.host.js',
    }))
    const standalone = readPackageDependencyFacts(root, pkg('@fixture/generated', manifestPath, subject.manifest),
      subject.role, state.workspaceNames, policy())
    expect(standalone.hostRuntimeExportUses).toEqual(subject.hostRuntimeExportUses)
    expect(collectPackageDependencyViolations(state)).toEqual([])
    repairPackageDependencyManifest(subject)
    expect(subject.manifest.dependencies?.zod).toBe('^4.0.0')
    expect(subject.manifest.devDependencies?.zod).toBeUndefined()

    delete subject.manifest.dependencies?.zod
    subject.manifest.devDependencies = { ...subject.manifest.devDependencies, zod: '^4.0.0' }
    expect(collectPackageDependencyViolations(state)).toContainEqual(
      expect.stringContaining('must be dependencies-only; found devDependencies'),
    )
    repairPackageDependencyManifest(subject)
    expect(subject.manifest.dependencies?.zod).toBe('^4.0.0')
    expect(subject.manifest.devDependencies?.zod).toBeUndefined()

    delete subject.manifest.dependencies?.zod
    expect(() => { repairPackageDependencyManifest(subject) }).toThrow('undeclared third-party dependency zod')
    expect(existsSync(join(root, 'packages/client/probe/lib'))).toBe(false)
    expect(readFileSync(join(root, manifestPath), 'utf8')).toBe(before)
    expect(readFileSync(join(root, 'packages/client/probe/src/index.ts'), 'utf8')).toBe(source)
  })

  it('does not infer a zod runtime dependency from a metadata-only Typert export', () => {
    const { root } = generatedHostFixture('object')
    const state = readPackageDependencyState(root, policy())
    const subject = state.facts[0]
    if (subject === undefined) throw new Error('generated Host fixture was not classified')

    expect(subject.hostRuntimeSourceUses.has('zod')).toBe(false)
    expect(expectedPackageDependencies(subject).get('zod')?.section).toBe('devDependencies')
    repairPackageDependencyManifest(subject)
    expect(subject.manifest.dependencies?.zod).toBeUndefined()
    expect(subject.manifest.devDependencies?.zod).toBe('^4.0.0')
    expect(existsSync(join(root, 'packages/client/probe/lib'))).toBe(false)
  })

  it('rejects a declared Host Typert module absent from the Host program', () => {
    const { root } = generatedHostFixture('schema')
    rmSync(join(root, 'tsconfig.host.json'))

    expect(() => readPackageDependencyState(root, policy())).toThrow(
      'packages/client/probe/package.json: declared Host Typert export has no generated module',
    )
    expect(existsSync(join(root, 'packages/client/probe/lib'))).toBe(false)
  })

  it('propagates generator publication errors without writing or repairing manifests', () => {
    const { root, manifestPath } = generatedHostFixture('schema')
    const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8')) as { files: string[] }
    manifest.files = []
    const before = JSON.stringify(manifest)
    writeFileSync(join(root, manifestPath), before)

    expect(() => readPackageDependencyState(root, policy())).toThrow(
      'package files must include lib/typert.host.js',
    )
    expect(readFileSync(join(root, manifestPath), 'utf8')).toBe(before)
    expect(existsSync(join(root, 'packages/client/probe/lib'))).toBe(false)
  })
})
