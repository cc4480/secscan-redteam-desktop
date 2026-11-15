/**
 * Cases covering the publication wiring the gate rejects: non-workspace ranges,
 * missing invariant metadata, and publication entries left behind after a
 * package omits its companion.
 */

import { describe, expect, it } from 'vitest'
import { collectPackageInvariantViolations } from './package-invariants.ts'
import { fixture } from './package-invariants.fixture-cases.ts'

describe('package invariant gate', () => {
  it('rejects caret ranges for the invariant peer and development dependency', () => {
    expect(collectPackageInvariantViolations(fixture({ invariantRange: 'workspace:^' }))).toEqual([
      { path: 'packages/core/probe/package.json', message: '@deepseek-ai/dsh-invariants must be a workspace:* peerDependency' },
      { path: 'packages/core/probe/package.json', message: '@deepseek-ai/dsh-invariants must be a workspace:* devDependency' },
    ])
  })

  it('rejects missing publication metadata and build output', () => {
    const violations = collectPackageInvariantViolations(fixture({
      invariantExport: false,
      invariantFile: false,
      invariantDependency: false,
      invariantReference: false,
      buildEntry: false,
    }))
    expect(violations.map(violation => violation.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('exports["./invariant"]'),
      expect.stringContaining('peerDependency'),
      expect.stringContaining('devDependency'),
      expect.stringContaining('TypeScript project references'),
      expect.stringContaining('must bundle lib/types/invariant.js'),
    ]))
  })

  it('rejects publication and build wiring left behind after omission', () => {
    const violations = collectPackageInvariantViolations(fixture({
      companion: false,
      invariantExport: true,
      invariantFile: true,
      invariantReference: true,
      buildEntry: true,
    }))
    expect(violations.map(violation => violation.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('exports["./invariant"] must be omitted'),
      expect.stringContaining('files must omit lib/invariant.js'),
      expect.stringContaining('TypeScript project references must omit ../../runtime-diagnostics/invariants'),
      expect.stringContaining('build override must omit lib/types/invariant.js'),
    ]))
  })
})
