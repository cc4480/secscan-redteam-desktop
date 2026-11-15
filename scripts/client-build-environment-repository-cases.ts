/**
 * Repository metadata the official build records: version, shortened commit,
 * and the dirty state, including its absence outside a worktree.
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  officialClientBuildEnvironment,
  repositoryClientBuildEnvironment,
  repositoryGitDirty,
  repositoryVersion,
} from './client-build-environment.ts'
import {
  COMMIT_HASH,
  fixtureRoot,
  git,
  repositoryFixture,
  write,
} from './client-build-environment-harness-cases.ts'

describe('client build environment', () => {
  it('owns repository version, commit, and dirty metadata for complete builds', () => {
    const fixture = repositoryFixture()
    const commit = git(fixture, ['rev-parse', '--short=7', 'HEAD'])

    expect(repositoryVersion(fixture)).toBe('1.2.3-rc.4')
    expect(repositoryGitDirty(fixture)).toBe(false)
    expect(repositoryClientBuildEnvironment(fixture, {
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH,
      DSH_CLIENT_EXTRA: 'preserved',
      DSH_CLIENT_GIT_DIRTY: 'true',
      DSH_CLIENT_VERSION: 'spoofed',
    })).toEqual({
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_EXTRA: 'preserved',
      DSH_CLIENT_VERSION: '1.2.3-rc.4',
    })
    expect(officialClientBuildEnvironment(fixture)).toEqual({
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: commit,
      DSH_CLIENT_TITLE: 'SecScan RedTeam',
      DSH_CLIENT_VERSION: '1.2.3-rc.4',
    })

    write(join(fixture, '.gitignore'), 'ignored.txt\n')
    git(fixture, ['add', '.gitignore'])
    git(fixture, ['commit', '-m', 'ignore fixture'])
    write(join(fixture, 'ignored.txt'), 'ignored\n')
    expect(repositoryGitDirty(fixture)).toBe(false)
    rmSync(join(fixture, 'ignored.txt'))

    write(join(fixture, 'tracked.txt'), 'unstaged\n')
    expect(repositoryGitDirty(fixture)).toBe(true)
    write(join(fixture, 'tracked.txt'), 'committed\n')
    expect(repositoryGitDirty(fixture)).toBe(false)

    write(join(fixture, 'tracked.txt'), 'staged\n')
    git(fixture, ['add', 'tracked.txt'])
    expect(repositoryGitDirty(fixture)).toBe(true)
    git(fixture, ['commit', '-m', 'staged fixture'])
    expect(repositoryGitDirty(fixture)).toBe(false)

    write(join(fixture, 'untracked.txt'), 'untracked\n')
    expect(repositoryGitDirty(fixture)).toBe(true)
    expect(repositoryClientBuildEnvironment(fixture, {
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH,
    })).toEqual({
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_GIT_DIRTY: 'true',
      DSH_CLIENT_VERSION: '1.2.3-rc.4',
    })

    rmSync(join(fixture, 'untracked.txt'))
    const submoduleSource = repositoryFixture('9.8.7')
    git(fixture, ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleSource, 'submodule'])
    git(fixture, ['commit', '-am', 'submodule fixture'])
    expect(repositoryGitDirty(fixture)).toBe(false)
    write(join(fixture, 'submodule/tracked.txt'), 'modified submodule\n')
    expect(repositoryGitDirty(fixture)).toBe(true)
  })

  it('omits dirty metadata when repository metadata is unavailable', () => {
    const fixture = fixtureRoot('dsh-client-build-no-git-')
    write(join(fixture, 'package.json'), '{"version":"2.0.0"}\n')

    expect(repositoryGitDirty(fixture)).toBeUndefined()
    expect(repositoryClientBuildEnvironment(fixture, {
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH,
      DSH_CLIENT_GIT_DIRTY: 'true',
    })).toEqual({
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_VERSION: '2.0.0',
    })
  })
})
