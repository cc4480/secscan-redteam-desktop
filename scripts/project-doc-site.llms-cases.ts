/** Cases for the llms.txt index and on-demand single-route projection. */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { docsPages } from '../website/docs.ts'
import { llmsTxt, rawMarkdownRoute } from './project-doc-site.ts'
import { fixture } from './project-doc-site.fixtures.ts'

describe('llmsTxt', () => {
  const site = { base: '/x/', title: 'DeepSeek Harness', description: '插件化 SDK' }

  it('lists every sidebar page as a base-prefixed raw-Markdown link', () => {
    const text = llmsTxt(site)
    for (const page of docsPages) {
      if (page.sidebar === null) expect(text, page.route).not.toContain(`](/x/${page.route})`)
      else expect(text, page.route).toContain(`- [${page.label}](/x/${page.route}): ${page.section}`)
    }
  })

  it('groups the two locale trees under their own headings', () => {
    const text = llmsTxt(site)
    expect(text.indexOf('## 简体中文')).toBeGreaterThan(-1)
    expect(text.indexOf('## English')).toBeGreaterThan(text.indexOf('## 简体中文'))
  })

  it('carries the site identity and the raw-Markdown convention', () => {
    const text = llmsTxt(site)
    expect(text.startsWith('# DeepSeek Harness\n')).toBe(true)
    expect(text).toContain('> 插件化 SDK')
    expect(text).toMatch(/`\.md`/)
  })
})

describe('rawMarkdownRoute', () => {
  it('projects one published route on demand', () => {
    const { root, pages } = fixture()
    writeFileSync(join(root, 'docs/a.md'), '# A\n\n[B](b.md)\n')

    expect(rawMarkdownRoute('en/a.md', { pages, repoRoot: root, repositoryRef: 'abc123' }))
      .toBe('# A\n\n[B](./reference/b.md)\n')
  })

  it('returns undefined for a path the manifest does not publish', () => {
    const { root, pages } = fixture()
    expect(rawMarkdownRoute('en/missing.md', { pages, repoRoot: root, repositoryRef: 'abc123' })).toBeUndefined()
  })
})
