/** The official client build artifacts the dsh family verifies before a release. */

import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { officialClientBuildEnvironment, writeClientBuildRecord } from '../client-build-environment.ts'
import { releaseFamily } from './families.ts'
import { temporaryRoot, write } from './families-fixtures-cases.ts'

/**
 * Materialize a client build fixture for one environment.
 * @param environment - the client build environment the recorded artifacts describe.
 * @returns The fixture root.
 */
function buildFixture(environment: Record<string, string>): string {
  const root = temporaryRoot('dsh-release-build-')
  write(join(root, 'package.json'), `${JSON.stringify({ version: environment.DSH_CLIENT_VERSION ?? '0.0.1' })}\n`)
  write(join(root, 'apps/web/dist/index.html'), '<main></main>')
  write(join(root, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(root, environment)
  return root
}

describe('release families', () => {
  it('requires a current official client build only for dsh artifacts', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')
    const officialEnvironment = officialClientBuildEnvironment(resolve(import.meta.dirname, '../..'))
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', officialEnvironment.DSH_CLIENT_COMMIT_HASH)
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})
    const missing = join(defaultBuild, 'missing')
    write(join(missing, 'package.json'), `${JSON.stringify({ version: officialEnvironment.DSH_CLIENT_VERSION })}\n`)

    expect(() => { dsh.verifyBuildArtifacts(official) }).not.toThrow()
    expect(() => { dsh.verifyBuildArtifacts(defaultBuild) }).toThrow(/DSH_CLIENT_TITLE/)
    expect(() => { dsh.verifyBuildArtifacts(missing) }).toThrow(/record.*missing/)
    expect(() => { vendor.verifyBuildArtifacts(missing) }).not.toThrow()

    write(join(official, 'packages/client/example/lib/client.js'), 'module.exports = { changed: true }\n')
    expect(() => { dsh.verifyBuildArtifacts(official) }).toThrow(/artifacts differ/)
  })
})
