/** Cases for rewriting links and image references inside projected Markdown. */

import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rewriteMarkdown } from './project-doc-site.ts'
import { fixture } from './project-doc-site.fixtures.ts'

describe('rewriteMarkdown', () => {
  it('maps published pages and pins unpublished source links', () => {
    const { root, pages } = fixture()
    const source = '[B](b.md#part) [source](../packages/tool.ts:2) [web](https://example.com)\n'
    expect(rewriteMarkdown(source, {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe(
      '[B](./reference/b.md#part) '
      + '[source](https://github.com/deepseek-ai/deepseek-harness/blob/abc123/packages/tool.ts#L2) '
      + '[web](https://example.com)\n',
    )
  })

  it('selects the published target in the current site locale', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('[B](b.md)\n', {
      locale: 'root',
      sourcePath: 'docs/a.md',
      route: 'a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe('[B](./reference-root/b.md)\n')
  })

  it('uses raw GitHub content for unpublished images when nothing places them', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('![logo](../packages/logo.svg)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe('![logo](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/abc123/packages/logo.svg)\n')
  })

  it('hands an image to the placer and uses the URL it returns', () => {
    // A raw GitHub URL cannot serve a private repository, so the site build
    // carries images itself; the placer is what puts them there. The stand-in
    // derives its URL the way the real one does, so a placer that stopped
    // returning the basename would fail here rather than pass on a constant.
    const { root, pages } = fixture()
    const placed: string[] = []
    expect(rewriteMarkdown('![logo](../packages/logo.svg)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
      placeImage: (absPath) => {
        const name = basename(absPath)
        placed.push(name)
        return `./${name}`
      },
    })).toBe('![logo](./logo.svg)\n')
    expect(placed).toEqual(['logo.svg'])
  })

  it('keeps a placed image\u2019s query or fragment', () => {
    // An SVG view fragment and a Vite query both change what the reference
    // means, and the GitHub branch has always carried them.
    const { root, pages } = fixture()
    expect(rewriteMarkdown('![logo](../packages/logo.svg#view)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
      placeImage: absPath => `./${basename(absPath)}`,
    })).toBe('![logo](./logo.svg#view)\n')
  })

  it('leaves a published page link to the route even when a placer exists', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('[B](b.md)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
      placeImage: () => { throw new Error('a page link must not be placed as an asset') },
    })).toBe('[B](./reference/b.md)\n')
  })

  it('does not rewrite Markdown-looking text inside code fences', () => {
    const { root, pages } = fixture()
    const source = '```md\n[B](b.md)\n```\n'
    expect(rewriteMarkdown(source, {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe(source)
  })

  it('replaces the destination token without changing repeated titles or escapes', () => {
    const { root, pages } = fixture()
    const source = '[title](b.md "b.md") [escaped](x\\(y\\).md)\n'
    expect(rewriteMarkdown(source, {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe(
      '[title](./reference/b.md "b.md") '
      + '[escaped](https://github.com/deepseek-ai/deepseek-harness/blob/abc123/docs/x(y).md)\n',
    )
  })

  it('routes switchers across locales and explicit locale siblings within their locale', () => {
    const { root, pages } = fixture()
    writeFileSync(join(root, 'docs/a.zh.md'), '# A\n')
    writeFileSync(join(root, 'docs/b.zh.md'), '# B\n')
    const paired = pages.filter(page => page.source !== 'docs/a.md').map(page => (
      page.locale === 'root' && page.source === 'docs/b.md'
        ? { ...page, source: 'docs/b.zh.md', sourceAliases: ['docs/b.md'] }
        : page
    ))
    paired.push(
      {
        locale: 'root', contentLocale: 'zh-CN', source: 'docs/a.zh.md', sourceAliases: ['docs/a.md'],
        route: 'guide/a.md', label: 'A', sidebar: 'zh-guide', section: 'Test', order: 1,
      },
      {
        locale: 'en', contentLocale: 'en-US', source: 'docs/a.md', sourceAliases: ['docs/a.zh.md'],
        route: 'en/guide/a.md', label: 'A', sidebar: 'en-guide', section: 'Test', order: 1,
      },
    )
    expect(rewriteMarkdown('[English](a.md) [B](b.zh.md)\n', {
      locale: 'root',
      sourcePath: 'docs/a.zh.md',
      route: 'guide/a.md',
      pages: paired,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe('[English](../en/guide/a.md) [B](../reference-root/b.md)\n')
    expect(rewriteMarkdown('[中文](a.zh.md) [B](b.md)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/guide/a.md',
      pages: paired,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe('[中文](../../guide/a.md) [B](../reference/b.md)\n')
  })

  it('fails loud when a relative target is missing', () => {
    const { root, pages } = fixture()
    expect(() => rewriteMarkdown('[missing](missing.md)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toThrow('links to missing path "missing.md"')
  })
})
