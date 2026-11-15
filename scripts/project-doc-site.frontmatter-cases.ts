/** Cases for projected frontmatter and rendered body reduction. */

import { describe, expect, it } from 'vitest'
import type { DocsPage } from '../website/docs.ts'
import { addProjectionFrontmatter, projectedPageContent, rawMarkdownPageContent } from './project-doc-site.ts'

describe('addProjectionFrontmatter', () => {
  it('adds frontmatter to an ordinary Markdown page', () => {
    expect(addProjectionFrontmatter('# Guide\n', { source: 'docs/guide.md', route: 'en/guide.md', sidebar: 'en-guide' })).toBe(
      '---\neditSource: "docs/guide.md"\nrawMarkdownPath: "en/guide.md"\n---\n\n# Guide\n',
    )
  })

  it('extends existing VitePress frontmatter', () => {
    expect(addProjectionFrontmatter('---\nlayout: home\n---\n', { source: 'docs/index.md', route: 'index.md', sidebar: null })).toBe(
      '---\neditSource: "docs/index.md"\nlayout: home\n---\n',
    )
  })

  it('adds the page-specific outline depth from the publication manifest', () => {
    expect(addProjectionFrontmatter('# Catalog\n', {
      source: 'docs/catalog.md',
      route: 'reference/index.md',
      sidebar: 'zh-reference',
      outline: [2, 4],
    })).toBe(
      '---\neditSource: "docs/catalog.md"\nrawMarkdownPath: "reference/index.md"\noutline: [2,4]\n---\n\n# Catalog\n',
    )
  })
})

describe('projectedPageContent', () => {
  const page = (sidebar: DocsPage['sidebar']): DocsPage => ({
    locale: 'root',
    contentLocale: 'zh-CN',
    source: 'docs/index.zh.md',
    route: 'index.md',
    label: 'Home',
    sidebar,
    section: 'Home',
    order: 0,
  })

  it('omits the source-only body from locale home pages', () => {
    expect(projectedPageContent(
      '---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n\n# Harness\n\n[English](index.md) | 中文\n',
      page(null),
    )).toBe('---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n')
  })

  it('keeps the full body for ordinary pages', () => {
    const markdown = '---\ntitle: Guide\n---\n\n# Guide\n'
    expect(projectedPageContent(markdown, page('zh-guide'))).toBe(markdown)
  })

  it('drops the language switcher the navigation bar already offers', () => {
    expect(projectedPageContent('# Guide\n\nEnglish | [中文](./en/guide)\n\nBody.\n', page('zh-guide')))
      .toBe('# Guide\n\nBody.\n')
    expect(projectedPageContent('# 指南\n\n[English](./en/guide) | 中文\n\n正文。\n', page('zh-guide')))
      .toBe('# 指南\n\n正文。\n')
  })

  it('drops the repository badge every page links from its footer', () => {
    const badge = '[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)'
    expect(projectedPageContent(`# Guide\n\nBody.\n\n${badge}\n`, page('zh-guide')))
      .toBe('# Guide\n\nBody.\n')
  })

  it('keeps a switcher-shaped line that is not the page header', () => {
    // A tutorial showing the convention must still render the example.
    const sample = '# Guide\n\nA\n\nB\n\nC\n\nD\n\nE\n\nEnglish | [中文](./x)\n'
    expect(projectedPageContent(sample, page('zh-guide'))).toBe(sample)
  })

  it('rejects a locale home source without frontmatter', () => {
    expect(() => projectedPageContent('# Harness\n', page(null)))
      .toThrow('locale home source "docs/index.zh.md" must start with YAML frontmatter')
  })
})

describe('rawMarkdownPageContent', () => {
  it('keeps the home body the rendered site omits and drops the VitePress frontmatter', () => {
    expect(rawMarkdownPageContent(
      '---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n\n# Harness\n\nEnglish | [中文](./index.md)\n\nBody.\n',
      'docs/user/index.zh.md',
    )).toBe('# Harness\n\nBody.\n')
  })

  it('drops the language switcher and repository badge like the rendered site', () => {
    const badge = '[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)'
    expect(rawMarkdownPageContent(`# Guide\n\nEnglish | [中文](./x)\n\nBody.\n\n${badge}\n`, 'docs/guide.md'))
      .toBe('# Guide\n\nBody.\n')
  })

  it('rejects unclosed frontmatter and names the page', () => {
    // The twin pass is the first place an ordinary page's frontmatter is
    // parsed, so an anonymous error would leave 168 routes to search.
    expect(() => rawMarkdownPageContent('---\nlayout: false\n', 'docs/broken.md'))
      .toThrow('project-doc-site: "docs/broken.md" has unclosed YAML frontmatter')
  })
})
