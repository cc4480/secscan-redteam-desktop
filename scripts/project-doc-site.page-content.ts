/**
 * Frontmatter and repository-chrome handling for projected pages: the fields
 * VitePress needs, and the lines that only address a canonical page's GitHub
 * reader.
 */

import type { DocsPage } from '../website/docs.ts'

/** The switcher line a canonical page carries so its GitHub reader can reach the other language. */
const LANGUAGE_SWITCHER = /^(?:English \| \[中文\]\([^)]*\)|\[English\]\([^)]*\) \| 中文)$/

/** The repository badge a canonical page carries for its GitHub reader. */
const REPOSITORY_BADGE = /^\[!\[[^\]]*\]\(https:\/\/img\.shields\.io\/[^)]*\)\]\([^)]*\)$/

/**
 * Drop the lines that address a canonical page's GitHub reader.
 *
 * The site carries a locale switcher in its navigation bar and links the
 * repository from every page, so projecting these lines would repeat both — the
 * switcher as the first element under each heading.
 *
 * @param markdown Rewritten canonical Markdown content.
 * @returns The content without the switcher line or the repository badge.
 */
export function withoutRepositoryChrome(markdown: string): string {
  const lines = markdown.split('\n')
  const switcher = lines.findIndex(line => LANGUAGE_SWITCHER.test(line))
  // Only the switcher introducing the page qualifies; further down the same
  // text is prose or a sample rather than the page's own header.
  if (switcher !== -1 && switcher < 8) {
    lines.splice(switcher, lines[switcher + 1] === '' ? 2 : 1)
  }
  const badge = lines.findLastIndex(line => REPOSITORY_BADGE.test(line))
  if (badge !== -1) {
    lines.splice(lines[badge - 1] === '' ? badge - 1 : badge, lines[badge - 1] === '' ? 2 : 1)
  }
  return lines.join('\n')
}

/**
 * Record canonical edit and raw-Markdown targets in VitePress frontmatter.
 *
 * @param markdown Projected Markdown content.
 * @param page Publication manifest entry for the content.
 * @returns Markdown with projection-owned frontmatter fields.
 */
export function addProjectionFrontmatter(markdown: string, page: Pick<DocsPage, 'source' | 'outline' | 'route' | 'sidebar'>): string {
  const fields = [
    `editSource: ${JSON.stringify(page.source)}`,
    ...(page.sidebar === null ? [] : [`rawMarkdownPath: ${JSON.stringify(page.route)}`]),
    ...(page.outline === undefined ? [] : [`outline: ${JSON.stringify(page.outline)}`]),
  ].join('\n')
  if (markdown.startsWith('---\n')) return markdown.replace('---\n', `---\n${fields}\n`)
  return `---\n${fields}\n---\n\n${markdown}`
}

/**
 * Select the Markdown rendered for one published page.
 *
 * @param markdown Rewritten canonical Markdown content.
 * @param page Publication manifest entry for the content.
 * @returns Full Markdown for ordinary pages or frontmatter-only Markdown for a locale home page.
 */
export function projectedPageContent(markdown: string, page: DocsPage): string {
  if (page.sidebar !== null) return withoutRepositoryChrome(markdown)
  if (!markdown.startsWith('---\n')) {
    throw new Error(`project-doc-site: locale home source ${JSON.stringify(page.source)} must start with YAML frontmatter.`)
  }
  const closingDelimiter = '\n---\n'
  const closing = markdown.indexOf(closingDelimiter, 4)
  if (closing === -1) {
    throw new Error(`project-doc-site: locale home source ${JSON.stringify(page.source)} has unclosed YAML frontmatter.`)
  }
  return markdown.slice(0, closing + closingDelimiter.length)
}
