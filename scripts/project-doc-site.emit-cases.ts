/** Cases for emitting the raw-Markdown mirror of the published manifest. */

import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import { docsPages } from '../website/docs.ts'
import { emitRawMarkdownPages, rawMarkdownFiles } from './project-doc-site.ts'
import { fixture, roots } from './project-doc-site.fixtures.ts'

describe('emitRawMarkdownPages', () => {
  function mirrorDir(): string {
    const out = mkdtempSync(join(tmpdir(), 'dsh-doc-mirror-'))
    roots.push(out)
    return out
  }

  it('writes every route with rewritten links, placed images, and no projection frontmatter', () => {
    const { root, pages } = fixture()
    writeFileSync(join(root, 'docs/a.md'), '[B](b.md) ![logo](../packages/logo.svg)\n')
    const out = mirrorDir()

    // The real path, because image placement proves containment via realpath.
    emitRawMarkdownPages(out, { pages, repoRoot: realpathSync(root), repositoryRef: 'abc123' })

    expect(readFileSync(join(out, 'a.md'), 'utf8')).toBe('\uFEFF[B](./reference-root/b.md) ![logo](./logo.svg)\n')
    expect(readFileSync(join(out, 'en/a.md'), 'utf8')).toBe('\uFEFF[B](./reference/b.md) ![logo](./logo.svg)\n')
    expect(readFileSync(join(out, 'reference-root/b.md'), 'utf8')).toBe('\uFEFF# B\n')
    expect(existsSync(join(out, 'logo.svg'))).toBe(true)
    expect(existsSync(join(out, 'en/logo.svg'))).toBe(true)
  })

  it('emits the full body of a locale home page', () => {
    const { root, pages } = fixture()
    writeFileSync(join(root, 'docs/home.md'), '---\nlayout: false\n---\n\n# Home\n\n[A](a.md)\n')
    pages.push({
      locale: 'root', contentLocale: 'zh-CN', source: 'docs/home.md', route: 'index.md',
      label: 'Home', sidebar: null, section: 'Home', order: 0,
    })
    const out = mirrorDir()

    emitRawMarkdownPages(out, { pages, repoRoot: root, repositoryRef: 'abc123' })

    expect(readFileSync(join(out, 'index.md'), 'utf8')).toBe('\uFEFF# Home\n\n[A](./a.md)\n')
  })

  it('emits a parent-level alias for an index route with links recomputed', () => {
    // A copied alias would carry the index page's relative links one directory
    // too high, so the alias is its own projection over the alias route.
    const { root, pages } = fixture()
    writeFileSync(join(root, 'docs/c.md'), '# C\n\n[A](a.md)\n')
    pages.push({
      locale: 'root', contentLocale: 'en-US', source: 'docs/c.md', route: 'guide/index.md',
      label: 'C', sidebar: 'zh-guide', section: 'Test', order: 3,
    })
    const out = mirrorDir()

    emitRawMarkdownPages(out, { pages, repoRoot: root, repositoryRef: 'abc123' })

    expect(readFileSync(join(out, 'guide/index.md'), 'utf8')).toBe('\uFEFF# C\n\n[A](../a.md)\n')
    expect(readFileSync(join(out, 'guide.md'), 'utf8')).toBe('\uFEFF# C\n\n[A](./a.md)\n')
  })

  it('identifies UTF-8 to document readers while fetch decoding preserves the Markdown body', async () => {
    const { root, pages } = fixture()
    const markdown = '# 中文 → Markdown\n'
    writeFileSync(join(root, 'docs/a.md'), markdown)
    const out = mirrorDir()
    emitRawMarkdownPages(out, { pages, repoRoot: root, repositoryRef: 'abc123' })
    const bytes = readFileSync(join(out, 'a.md'))
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(await new Response(bytes).text()).toBe(markdown)
    expect(fromMarkdown(bytes.toString('utf8')).children[0]?.type).toBe('heading')
  })

  it('refuses to overwrite a file the build already carries', () => {
    // The twin pass writes into a populated build directory, and VitePress has
    // already copied `website/public/` there; a page image sharing one of
    // those names must fail loud instead of silently replacing the site file.
    const { root, pages } = fixture()
    writeFileSync(join(root, 'docs/a.md'), '![logo](../packages/logo.svg)\n')
    const out = mirrorDir()
    writeFileSync(join(out, 'logo.svg'), 'public copy\n')

    expect(() => {
      emitRawMarkdownPages(out, { pages, repoRoot: realpathSync(root), repositoryRef: 'abc123' })
    }).toThrow('would overwrite')
    expect(readFileSync(join(out, 'logo.svg'), 'utf8')).toBe('public copy\n')
  })
})

describe('rawMarkdownFiles', () => {
  it('lists every route plus a parent alias per index route', () => {
    const files = rawMarkdownFiles()
    for (const page of docsPages) expect(files).toContain(page.route)
    expect(files).toContain('reference.md')
    expect(files).toContain('en/reference.md')
    expect(files).toContain('en.md')
    // The root home has no parent to alias into; `/` is documented as `/index.md`.
    expect(files).not.toContain('.md')
    expect(new Set(files).size).toBe(files.length)
  })
})
