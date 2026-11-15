/** Cases for the sidebar collections' section placement and ordering. */

import { describe, expect, it } from 'vitest'
import { docsPages, landingLink, routeLink, sectionSpec } from '../website/docs.ts'

describe('sidebar ordering', () => {
  it('places every section a sidebar collection owns', () => {
    for (const page of docsPages) {
      if (page.sidebar === null) continue
      expect(() => sectionSpec(page.locale, page.section), page.route).not.toThrow()
    }
  })

  it('refuses a section with no declared placement', () => {
    expect(() => sectionSpec('root', '数据结构'))
      .toThrow('Sidebar section "数据结构" has no placement in the root locale.')
  })

  it('declares placements per locale rather than in one shared list', () => {
    // `SDK` labels a group in both locales, so one shared list would have to
    // rank it against `入门` and against `Guide` at the same position.
    expect(sectionSpec('root', 'SDK').index).toBeGreaterThan(sectionSpec('root', '入门').index)
    expect(sectionSpec('en', 'SDK').index).toBeGreaterThan(sectionSpec('en', 'Guide').index)
    expect(() => sectionSpec('en', '入门')).toThrow()
    expect(() => sectionSpec('root', 'Guide')).toThrow()
  })

  it('lands every navigation item on a page the manifest publishes', () => {
    // The navigation bar named `/guide/` while the manifest published the guide's
    // first page at `guide/quickstart.md`, so the item served a 404.
    const collections = [
      ['root', 'zh-guide'], ['root', 'zh-develop'], ['root', 'zh-reference'],
      ['en', 'en-guide'], ['en', 'en-develop'], ['en', 'en-reference'],
    ] as const
    const published = new Set(docsPages.map(page => routeLink(page.route)))
    for (const [locale, collection] of collections) {
      expect(published, `${locale}/${collection}`).toContain(landingLink(locale, collection))
    }
  })

  it('collapses the subsystem groups and leaves the smaller ones open', () => {
    expect(sectionSpec('root', '执行与工具').collapsed).toBe(true)
    expect(sectionSpec('en', 'Execution and tools').collapsed).toBe(true)
    expect(sectionSpec('root', '概念').collapsed).toBeUndefined()
  })

  it('gives each page its own position within a section', () => {
    // Sidebar entries sort by order alone, so a shared value leaves the two
    // pages ranked by whichever manifest block happens to be concatenated
    // first rather than by an intent the manifest states.
    const taken = new Map<string, string>()
    const collisions: string[] = []
    for (const page of docsPages) {
      const slot = `${page.locale}/${String(page.sidebar)}/${page.section}#${page.order}`
      const holder = taken.get(slot)
      if (holder === undefined) taken.set(slot, page.label)
      else collisions.push(`${slot}: ${holder} / ${page.label}`)
    }
    expect(collisions).toEqual([])
  })
})
