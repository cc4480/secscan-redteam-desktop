/**
 * The client build record: replaying a recorded environment against the
 * artifact tree it claims to describe.
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readClientBuildRecord } from './client-build-environment.ts'
import {
  buildFixture,
  COMMIT_HASH,
  write,
} from './client-build-environment-harness-cases.ts'

describe('client build environment', () => {
  it('binds the recorded environment to a complete set of client artifacts', () => {
    const officialEnvironment = {
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'SecScan RedTeam',
      DSH_CLIENT_VERSION: '1.2.3',
    }
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})

    expect(readClientBuildRecord(official, officialEnvironment).environment).toEqual(officialEnvironment)
    expect(() => { readClientBuildRecord(defaultBuild, officialEnvironment) }).toThrow(/DSH_CLIENT_/)
    expect(() => { readClientBuildRecord(join(defaultBuild, 'missing')) }).toThrow(/record.*missing/)

    write(join(official, 'apps/web/dist/index.html'), '<main>changed</main>')
    expect(() => { readClientBuildRecord(official) }).toThrow(/artifacts differ/)

    const chunked = buildFixture(officialEnvironment)
    write(join(chunked, 'packages/client/example/lib/client.pdf.js'), 'module.exports = {}\n')
    expect(() => { readClientBuildRecord(chunked) }).toThrow(/artifacts differ/)
  })
})
