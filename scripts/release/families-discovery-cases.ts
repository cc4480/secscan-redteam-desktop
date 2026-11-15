/** Release family discovery, publish-set filtering, shared version rules, and tag naming. */

import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planShared } from './bump.ts'
import { releaseFamily } from './families.ts'
import { member, temporaryRoot, write } from './families-fixtures-cases.ts'

describe('release families', () => {
  it('publishes all current experimental packages', () => {
    const members = releaseFamily('dsh').members(resolve(import.meta.dirname, '../..'))

    expect(members
      .filter(member => member.directory.startsWith('packages/experimental/'))
      .map(member => member.name)).toEqual([
      '@deepseek-ai/dsh-experimental-agent-team-profile',
      '@deepseek-ai/dsh-experimental-agent-team',
      '@deepseek-ai/dsh-experimental-api-speech-to-text',
      '@deepseek-ai/dsh-experimental-auto-review',
      '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp',
      '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
      '@deepseek-ai/dsh-experimental-browser-use-runtime',
      '@deepseek-ai/dsh-experimental-browser-use-stagehand-native',
      '@deepseek-ai/dsh-experimental-client-ui-agent-team',
      '@deepseek-ai/dsh-experimental-client-ui-voice-input',
      '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp',
      '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
      '@deepseek-ai/dsh-experimental-inspector',
      '@deepseek-ai/dsh-experimental-ptc-runtime-python',
      '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
      '@deepseek-ai/dsh-experimental-speech-to-text',
      '@deepseek-ai/dsh-experimental-tool-agent-team',
      '@deepseek-ai/dsh-experimental-voice-input-bundle',
      '@deepseek-ai/dsh-experimental-webworker-packer',
      '@deepseek-ai/dsh-experimental-webworker-runtime',
    ])
  })

  it('excludes private applications from the publish set', () => {
    const root = temporaryRoot('dsh-release-private-')
    write(join(root, 'apps/public/package.json'), '{"name":"@deepseek-ai/dsh-public","version":"0.0.1"}\n')
    write(join(root, 'apps/private/package.json'), '{"name":"@deepseek-ai/dsh-private","version":"0.0.1","private":true}\n')

    expect(releaseFamily('dsh').members(root).map(entry => entry.name)).toEqual(['@deepseek-ai/dsh-public'])
  })

  it('publishes unlisted experimental packages while retaining private exclusions', () => {
    const root = temporaryRoot('dsh-release-experimental-')
    write(join(root, 'packages/experimental/prototype/package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-experimental-prototype',
      version: '0.0.1',
      publishConfig: { access: 'public' },
    }))
    write(join(root, 'packages/experimental/inspector/package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-experimental-inspector',
      version: '0.0.1',
      private: true,
    }))

    expect(releaseFamily('dsh').members(root).map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-experimental-prototype',
    ])
  })

  it('bumps private dsh workspaces without adding release tags', () => {
    const root = temporaryRoot('dsh-release-version-')
    write(join(root, 'package.json'), '{"version":"0.0.1"}\n')
    write(join(root, 'apps/desktop/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/experimental/prototype/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/core/unselected/package.json'), '{"version":"0.0.1"}\n')

    const dsh = releaseFamily('dsh')
    const published = member('packages/core/published', '@deepseek-ai/dsh-published')
    const { planned } = planShared(dsh, root, [published], '0.0.2')

    expect(planned.map(entry => ({ path: entry.manifestPath, tag: entry.tag }))).toEqual([
      { path: 'package.json', tag: undefined },
      { path: 'packages/core/published/package.json', tag: 'dsh-v0.0.2' },
      { path: 'apps/desktop/package.json', tag: undefined },
      { path: 'packages/experimental/prototype/package.json', tag: undefined },
    ])
  })

  it.each(['0.0.2-alpha.1', '0.0.2-canary.1', '0.0.2-rc.1'])(
    'accepts the explicit dsh prerelease version %s',
    (version) => {
      const root = temporaryRoot('dsh-release-prerelease-')
      write(join(root, 'package.json'), '{"version":"0.0.1"}\n')

      const dsh = releaseFamily('dsh')
      const published = member('packages/core/published', '@deepseek-ai/dsh-published')
      const plan = planShared(dsh, root, [published], version)

      expect(plan.version).toBe(version)
      expect(plan.planned[1]?.tag).toBe(`dsh-v${version}`)
    },
  )

  it('names one tag for the whole dsh family and one per vendored package', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')
    const cli = member('apps/cli', '@deepseek-ai/dsh')
    const cordis = { ...member('vendor/cordis', '@deepseek-ai/cordis'), version: '4.0.1' }

    expect(dsh.tagFor(cli)).toBe('dsh-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
  })

  it('assigns alpha and canary dist-tags only to dsh releases', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')

    expect(dsh.distTagForVersion('0.0.2-alpha.1')).toBe('alpha')
    expect(dsh.distTagForVersion('0.0.2-canary.1')).toBe('canary')
    expect(dsh.distTagForVersion('0.0.2-rc.1')).toBe('next')
    expect(dsh.distTagForVersion('0.0.2')).toBeUndefined()
    expect(vendor.distTagForVersion('4.0.1-alpha.1')).toBe('next')
    expect(vendor.distTagForVersion('4.0.1-canary.1')).toBe('next')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('apps/cli', '@deepseek-ai/dsh'),
      { ...member('apps/web', '@deepseek-ai/dsh-web-frontend'), version: '0.0.2' },
    ]

    expect(() => { dsh.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { dsh.verifyVersions([members[0]!]) }).not.toThrow()
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    const vendor = releaseFamily('vendor')
    const members = [
      { ...member('vendor/cordis', '@deepseek-ai/cordis'), version: '4.0.1' },
      { ...member('vendor/cosmokit', '@deepseek-ai/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })
})
