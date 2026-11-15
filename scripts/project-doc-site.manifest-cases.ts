/** Cases for the raw-Markdown projection of the full published manifest. */

import { existsSync, globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Nodes } from 'mdast'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { docsPages } from '../website/docs.ts'
import { emitRawMarkdownPages, rawMarkdownFiles } from './project-doc-site.ts'
import { repositoryRoot } from './project-doc-site.fixtures.ts'

describe('raw Markdown projection of the published manifest', () => {
  let mirror: string

  // Coverage instrumentation on a loaded CI runner stretches the full-manifest
  // emission and the 181-file link walk past vitest's 5s default.
  beforeAll(() => {
    mirror = mkdtempSync(join(tmpdir(), 'dsh-doc-mirror-real-'))
    emitRawMarkdownPages(mirror, { pages: docsPages, repoRoot: repositoryRoot, repositoryRef: 'master' })
  }, 60_000)

  afterAll(() => {
    rmSync(mirror, { recursive: true, force: true })
  })

  it('emits every published route and every index alias', () => {
    for (const file of rawMarkdownFiles()) {
      expect(existsSync(join(mirror, file)), file).toBe(true)
    }
  })

  it('emits home pages with their bodies instead of the frontmatter stub', () => {
    for (const route of ['index.md', 'en/index.md']) {
      const home = new TextDecoder().decode(readFileSync(join(mirror, route)))
      expect(home.startsWith('---'), route).toBe(false)
      expect(home, route).toContain('# DeepSeek Harness')
    }
  })

  it('resolves every relative link inside the emitted tree', { timeout: 60_000 }, () => {
    // Raw pages are read outside the site, so a relative target that only the
    // rendered site serves would strand every agent following it.
    const broken: string[] = []
    for (const file of globSync('**/*.md', { cwd: mirror }).sort()) {
      for (const target of relativeTargets(readFileSync(join(mirror, file), 'utf8'))) {
        if (!existsSync(resolve(mirror, dirname(file), target))) broken.push(`${file}: ${target}`)
      }
    }
    expect(broken).toEqual([])
  })
})

function relativeTargets(markdown: string): string[] {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const targets: string[] = []
  const visit = (node: Nodes): void => {
    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && 'url' in node) {
      const external = node.url.startsWith('#')
        || node.url.startsWith('/')
        || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(node.url)
      const path = node.url.split(/[?#]/)[0] ?? ''
      if (!external && path !== '') targets.push(decodeURIComponent(path))
    }
    if ('children' in node) {
      for (const child of node.children) visit(child)
    }
  }
  visit(tree)
  return targets
}
