/**
 * Public client environment values: the exact profile assertion, and inheritance
 * plus isolation of an explicit official profile.
 */

import { describe, expect, it } from 'vitest'
import {
  assertClientBuildEnvironment,
  clientBuildProcessEnvironment,
  repositoryCommitHash,
  resolveClientBuildEnvironment,
} from './client-build-environment.ts'
import { COMMIT_HASH } from './client-build-environment-harness-cases.ts'

describe('client build environment', () => {
  it('requires an exact public environment for a named artifact profile', () => {
    const expected = {
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'SecScan RedTeam',
      DSH_CLIENT_VERSION: '1.2.3',
    } as const

    expect(() => { assertClientBuildEnvironment({ PATH: '/bin', ...expected }, expected) }).not.toThrow()
    expect(() => { assertClientBuildEnvironment({}, expected) }).toThrow(/DSH_CLIENT_TITLE/)
    expect(() => { assertClientBuildEnvironment({ DSH_CLIENT_TITLE: 'Other' }, expected) }).toThrow(/DSH_CLIENT_TITLE/)
    expect(() => {
      assertClientBuildEnvironment({ ...expected, DSH_CLIENT_UNDECLARED: 'value' }, expected)
    }).toThrow(/DSH_CLIENT_UNDECLARED/)
  })

  it('inherits public values by default and isolates an explicit official profile', () => {
    const parent = {
      PATH: '/bin',
      DSH_BUILD_CLIENT_PROFILE: 'official',
      DSH_CLIENT_BUILD_PROFILE: 'local',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_GIT_DIRTY: 'true',
      DSH_CLIENT_TITLE: 'Local title',
      DSH_CLIENT_VERSION: '1.2.3',
      DSH_CLIENT_EXTRA: 'local-extra',
    }

    expect(resolveClientBuildEnvironment({ DSH_CLIENT_TITLE: 'Local title' })).toEqual({
      DSH_CLIENT_TITLE: 'Local title',
    })
    expect(resolveClientBuildEnvironment(parent)).toEqual({
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'SecScan RedTeam',
      DSH_CLIENT_VERSION: '1.2.3',
    })
    expect(() => {
      resolveClientBuildEnvironment({ DSH_BUILD_CLIENT_PROFILE: 'official' })
    }).toThrow(/DSH_CLIENT_COMMIT_HASH/)
    expect(() => {
      resolveClientBuildEnvironment({
        DSH_BUILD_CLIENT_PROFILE: 'official',
        DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      })
    }).toThrow(/DSH_CLIENT_VERSION/)
    expect(() => { resolveClientBuildEnvironment({}, 'unknown') }).toThrow(/unknown client build profile/)
    expect(clientBuildProcessEnvironment(parent, {
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'SecScan RedTeam',
      DSH_CLIENT_VERSION: '1.2.3',
    })).toEqual({
      PATH: '/bin',
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'SecScan RedTeam',
      DSH_CLIENT_VERSION: '1.2.3',
    })
    expect(repositoryCommitHash('/unused', { DSH_CLIENT_COMMIT_HASH: COMMIT_HASH })).toBe(COMMIT_HASH.slice(0, 7))
  })
})
