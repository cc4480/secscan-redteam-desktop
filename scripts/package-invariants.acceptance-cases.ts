/**
 * Cases covering the invariant wiring the gate accepts: a hand-owned companion,
 * packages that cleanly omit it, development-only dependencies, Client-only
 * exports, and project references owned by a package-local leaf project.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectPackageInvariantViolations, packageInvariantOwners } from './package-invariants.ts'
import { fixture } from './package-invariants.fixture-cases.ts'

describe('package invariant gate', () => {
  it('accepts a hand-owned checking companion with publication metadata', () => {
    expect(collectPackageInvariantViolations(fixture())).toEqual([])
  })

  it('accepts a package that cleanly omits an invariant companion', () => {
    const root = fixture({ companion: false })
    expect(collectPackageInvariantViolations(root)).toEqual([])
    expect(packageInvariantOwners(root)).toEqual([])
  })

  it('requires an omitted companion to have a README reason sentence', () => {
    const violations = collectPackageInvariantViolations(fixture({
      companion: false,
      omissionReason: false,
    }))
    expect(violations).toContainEqual({
      path: 'packages/core/probe/README.md',
      message: 'omitted companion requires a README "No ... companion is published" reason sentence',
    })
  })

  it('accepts development-only invariants for configured Host dependencies', () => {
    expect(collectPackageInvariantViolations(fixture({ packageName: '@deepseek-ai/dsh-llm' }))).toEqual([])
  })

  it('accepts development-only invariants for client packages', () => {
    expect(collectPackageInvariantViolations(fixture({
      packageName: '@deepseek-ai/dsh-client-probe',
      packageDirectory: 'packages/client/probe',
    }))).toEqual([])
  })

  it('accepts development-only invariants for packages with a dsh.client entry', () => {
    expect(collectPackageInvariantViolations(fixture({ clientDeclaration: true, clientExport: true }))).toEqual([])
  })

  it('keeps invariant peers for packages that only export a Client API', () => {
    expect(collectPackageInvariantViolations(fixture({ clientExport: true }))).toEqual([])
  })

  it('keeps invariant peers for experimental packages with a dsh.client entry', () => {
    expect(collectPackageInvariantViolations(fixture({
      packageDirectory: 'packages/experimental/probe',
      clientDeclaration: true,
      clientExport: true,
    }))).toEqual([])
  })

  it('accepts an invariant reference owned by a package-local leaf project', () => {
    const root = fixture({ invariantReference: false })
    const dir = join(root, 'packages/core/probe')
    writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify({
      files: [],
      references: [{ path: './tsconfig.host.json' }],
    }, null, 2)}\n`)
    writeFileSync(join(dir, 'tsconfig.host.json'), `${JSON.stringify({
      references: [{ path: '../../runtime-diagnostics/invariants' }],
    }, null, 2)}\n`)

    expect(collectPackageInvariantViolations(root)).toEqual([])
  })
})
