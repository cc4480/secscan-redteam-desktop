/** Cases for the website source layout and the documentation site build. */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanDocSiteOutput, docSiteBuildOptions } from '../website/build.ts'
import { repositoryRoot, roots, unexpectedWebsiteMarkdown } from './project-doc-site.fixtures.ts'

describe('website source layout', () => {
  it('rejects Markdown outside the subtree instructions', () => {
    expect(unexpectedWebsiteMarkdown([
      'website/AGENTS.md',
      'website/docs.ts',
      'website/zh-CN/api/harness/service.md',
    ])).toEqual(['website/zh-CN/api/harness/service.md'])
  })

  it('contains no tracked or unignored documentation copies', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'website'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    ).split('\n').filter(file => file !== '' && existsSync(resolve(repositoryRoot, file)))

    expect(
      unexpectedWebsiteMarkdown(files),
      'Keep canonical Markdown under docs/ and publish it through website/docs.ts.',
    ).toEqual([])
  })
})

describe('documentation site build', () => {
  it.each([
    { mode: 'SPA', mpa: false, expectedMpa: undefined },
    { mode: 'MPA', mpa: true, expectedMpa: 'true' },
  ])('$mode build removes stale output before writing', async ({ mpa, expectedMpa }) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-doc-build-'))
    roots.push(root)
    const outDir = join(root, '.dist')
    const stale = join(outDir, 'stale.md')
    mkdirSync(outDir)
    writeFileSync(stale, 'stale\n')

    const options = docSiteBuildOptions(root, mpa)
    expect(options.mpa).toBe(expectedMpa)
    expect(existsSync(stale)).toBe(true)
    await options.onAfterConfigResolve?.({ outDir } as never)
    expect(existsSync(outDir)).toBe(false)
  })

  it('refuses to remove the site root or an outside directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-doc-build-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'dsh-doc-build-outside-'))
    roots.push(root, outside)
    writeFileSync(join(root, 'keep'), 'root\n')
    writeFileSync(join(outside, 'keep'), 'outside\n')

    expect(() => {
      cleanDocSiteOutput(root, root)
    }).toThrow('must be a child of site root')
    expect(() => {
      cleanDocSiteOutput(root, outside)
    }).toThrow('must be a child of site root')
    expect(readFileSync(join(root, 'keep'), 'utf8')).toBe('root\n')
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('outside\n')
  })

  it('unlinks a link-shaped output without removing its target', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-doc-build-link-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'dsh-doc-build-link-target-'))
    roots.push(root, outside)
    const outDir = join(root, '.dist')
    const keep = join(outside, 'keep')
    writeFileSync(keep, 'outside\n')
    symlinkSync(outside, outDir, 'junction')

    cleanDocSiteOutput(root, outDir)

    expect(existsSync(outDir)).toBe(false)
    expect(readFileSync(keep, 'utf8')).toBe('outside\n')
  })

  it('refuses output whose nearest existing parent resolves outside the site root', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-doc-build-parent-link-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'dsh-doc-build-parent-link-target-'))
    roots.push(root, outside)
    const linkedParent = join(root, 'linked')
    const outDir = join(linkedParent, 'missing', '.dist')
    const keep = join(outside, 'keep')
    writeFileSync(keep, 'outside\n')
    symlinkSync(outside, linkedParent, 'junction')

    try {
      expect(() => {
        cleanDocSiteOutput(root, outDir)
      }).toThrow('must resolve inside site root')
      expect(readFileSync(keep, 'utf8')).toBe('outside\n')
    } finally {
      unlinkSync(linkedParent)
    }
  })
})
