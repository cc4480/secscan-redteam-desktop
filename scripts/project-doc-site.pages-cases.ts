/** Cases for the published manifest's locale routes and link projection. */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { docsPages } from '../website/docs.ts'
import { projectedPageContent, rewriteMarkdown } from './project-doc-site.ts'
import { repositoryRoot } from './project-doc-site.fixtures.ts'

describe('docsPages locale routes', () => {
  it('redirects both locale roots to their locale-relative quick-start page', () => {
    const homes = docsPages.filter(page => page.sidebar === null)
    expect(homes.map(page => page.route).sort()).toEqual(['en/index.md', 'index.md'])
    for (const page of homes) {
      const source = readFileSync(resolve(repositoryRoot, page.source), 'utf8')
      const projected = projectedPageContent(source, page)
      expect(projected).toContain('layout: false')
      expect(projected).toContain('http-equiv: refresh')
      expect(projected).toContain('content: 0; url=./guide/quickstart')
      expect(projected).not.toContain('# DeepSeek Harness')
    }
  })

  it('publishes every route in both locales and uses every available Chinese counterpart', () => {
    const byRoute = new Map(docsPages.map(page => [page.route, page]))
    for (const page of docsPages.filter(page => page.locale === 'root')) {
      const counterpart = byRoute.get(`en/${page.route}`)
      expect(counterpart, page.route).toBeDefined()
      expect(counterpart?.locale).toBe('en')
      if (page.contentLocale === 'zh-CN') {
        expect(page.source).toMatch(/\.zh\.md$/)
        expect(page.contentLocale).toBe('zh-CN')
        expect(counterpart?.source).toBe(page.source.replace(/\.zh\.md$/, '.md'))
        expect(counterpart?.contentLocale).toBe('en-US')
      } else {
        expect(counterpart?.source).toBe(page.source)
        expect(counterpart?.contentLocale).toBe(page.contentLocale)
        const chineseSource = page.source.replace(/\.md$/, '.zh.md')
        expect(
          existsSync(resolve(repositoryRoot, chineseSource)),
          `${page.route} has a Chinese counterpart but projects English`,
        ).toBe(false)
      }
    }
  })

  it('projects the audited tutorial entry links from explicit locale index pages', () => {
    const entries = [
      ['docs/user/develop/basic/config.md', '../framework/index.md'],
      ['docs/user/develop/basic/publish.md', '../framework/index.md'],
      ['docs/user/develop/basic/tool.md', './index.md'],
      ['docs/user/develop/basic/tool.md', '../practice/index.md'],
      ['docs/user/develop/framework/events.md', '../practice/index.md'],
      ['docs/user/develop/framework/service.md', '../practice/index.md'],
      ['docs/user/develop/practice/index.md', '../basic/index.md'],
      ['docs/user/guide/index.md', '../develop/basic/index.md'],
    ] as const

    for (const [englishSource, englishTarget] of entries) {
      for (const locale of ['en', 'root'] as const) {
        const source = locale === 'root' ? englishSource.replace(/\.md$/, '.zh.md') : englishSource
        const target = locale === 'root' ? englishTarget.replace(/\.md$/, '.zh.md') : englishTarget
        const page = docsPages.find(candidate => candidate.locale === locale && candidate.source === source)
        expect(page, `${locale}:${source}`).toBeDefined()
        expect(readFileSync(resolve(repositoryRoot, source), 'utf8')).toContain(`](${target})`)
        expect(rewriteMarkdown(`[Entry](${target})\n`, {
          locale,
          sourcePath: source,
          route: page!.route,
          pages: docsPages,
          repoRoot: repositoryRoot,
          repositoryRef: 'abc123',
        })).toBe(`[Entry](${englishTarget})\n`)
      }
    }
  })

  it('indexes every subsystem page in both sides of the folder README', () => {
    const pages = globSync(join(repositoryRoot, 'docs/subsystems/*.md'))
      .map(page => basename(page))
      .filter(page => !page.endsWith('.zh.md') && page !== 'README.md')
      .sort()
    expect(pages.length).toBeGreaterThan(0)
    for (const readme of ['README.md', 'README.zh.md']) {
      const rows = readFileSync(join(repositoryRoot, 'docs/subsystems', readme), 'utf8')
      const missing = pages.filter((page) => {
        const target = readme.endsWith('.zh.md') ? page.replace(/\.md$/, '.zh.md') : page
        return !rows.includes(`| [${page}](${target}) |`)
      })
      expect(missing, `${readme} must carry one table row per subsystem page`).toEqual([])
    }
  })

  it('places the shared todo fragment alias on the translated todo section', () => {
    const catalog = readFileSync(resolve(repositoryRoot, 'docs/tool-catalog.zh.md'), 'utf8')
    expect(catalog.match(/<a id="deepseek-aidsh-tool-todo"><\/a>/g)).toHaveLength(1)
    expect(catalog).toContain(
      '<a id="deepseek-aidsh-tool-todo"></a>\n\n## `@deepseek-ai/dsh-tool-todo`',
    )
  })

  it('projects every published subsystem page in Chinese', () => {
    const rootPages = docsPages.filter(page => (
      page.locale === 'root' && page.route.startsWith('reference/subsystems/')
    ))
    const translated = rootPages.filter(page => page.contentLocale === 'zh-CN')
    const fallbacks = rootPages.filter(page => page.contentLocale === 'en-US')

    expect(translated).toHaveLength(48)
    expect(translated.every(page => page.source.endsWith('.zh.md'))).toBe(true)
    expect(fallbacks).toEqual([])
  })

  it('publishes the Cordis core API under matching locale structures', () => {
    const files = ['context.md', 'events.md', 'fiber.md', 'registry.md', 'service.md']
    for (const file of files) {
      const root = docsPages.find(page => page.route === `reference/cordis-api/${file}`)
      const english = docsPages.find(page => page.route === `en/reference/cordis-api/${file}`)
      expect(root?.source).toBe(`docs/cordis-api/${file.replace(/\.md$/, '.zh.md')}`)
      expect(root?.contentLocale).toBe('zh-CN')
      expect(root?.section).toBe('Cordis API')
      expect(english?.source).toBe(`docs/cordis-api/${file}`)
      expect(english?.contentLocale).toBe('en-US')
      expect(english?.section).toBe('Cordis Core API')
    }
  })

  it('keeps Cordis inherited on the English fallback in both locales', () => {
    const pages = docsPages.filter(page => page.route.endsWith('reference/cordis-api/inherited.md'))
    expect(pages).toHaveLength(2)
    expect(pages.every(page => page.source === 'docs/cordis-api/inherited.md')).toBe(true)
    expect(pages.every(page => page.contentLocale === 'en-US')).toBe(true)
  })

  it('includes persistence event headings in both locale outlines', () => {
    const pages = docsPages.filter(page => page.route.endsWith('reference/persistence-catalog.md'))
    expect(pages).toHaveLength(2)
    expect(pages.map(page => page.source).sort()).toEqual([
      'docs/persistence-catalog.md',
      'docs/persistence-catalog.zh.md',
    ])
    expect(pages.map(page => page.outline)).toEqual(['deep', 'deep'])
  })

  it('projects reviewed generated counterparts into root locale routes', () => {
    // module-graph, event-producer-consumer, and graph-atlas are paired but intentionally unpublished.
    const routes = [
      'reference/capability-seams.md',
      'reference/agent-lifecycle.md',
      'reference/tool-execution-pipeline.md',
      'reference/config-catalog.md',
      'reference/tool-catalog.md',
      'reference/persistence-catalog.md',
      'reference/cordis-api/context.md',
      'reference/cordis-api/events.md',
      'reference/cordis-api/fiber.md',
      'reference/cordis-api/registry.md',
      'reference/cordis-api/service.md',
    ]
    const pages = routes.map(route => docsPages.find(page => page.route === route))
    expect(pages.every(page => page?.contentLocale === 'zh-CN')).toBe(true)
    expect(pages.every(page => page?.source.endsWith('.zh.md'))).toBe(true)
  })
})
