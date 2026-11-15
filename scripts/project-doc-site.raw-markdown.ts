/**
 * The raw-Markdown twin of published pages: frontmatter-free content, the
 * parent-level alias of an index route, and the file list both trees emit.
 */

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { docsPages, type DocsPage } from '../website/docs.ts'
import { defaultProjectionContext, type ProjectionContext } from './project-doc-site.context.ts'
import { withoutRepositoryChrome } from './project-doc-site.page-content.ts'
import { rewriteMarkdown } from './project-doc-site.rewrite.ts'

/**
 * Strip the leading YAML frontmatter of a projected page.
 *
 * @param markdown Rewritten canonical Markdown content.
 * @param source Repository-relative page source, named by the failure.
 * @returns The content after the frontmatter block, or the input when none opens it.
 */
function withoutFrontmatter(markdown: string, source: string): string {
  if (!markdown.startsWith('---\n')) return markdown
  const closingDelimiter = '\n---\n'
  const closing = markdown.indexOf(closingDelimiter, 4)
  if (closing === -1) {
    throw new Error(`project-doc-site: ${JSON.stringify(source)} has unclosed YAML frontmatter.`)
  }
  return markdown.slice(closing + closingDelimiter.length).replace(/^\n+/, '')
}

/**
 * Parent-level alias route of an index route, or `undefined` for other routes.
 *
 * The rendered site shows an index route as a directory URL, so "append
 * `.md`" naturally lands on `<dir>.md` once the trailing slash is dropped.
 * The root `index.md` has no parent to alias into.
 */
export function indexAliasRoute(route: string): string | undefined {
  const match = /^(.+)\/index\.md$/.exec(route)
  return match?.[1] === undefined ? undefined : `${match[1]}.md`
}

/**
 * Site-relative Markdown files the raw-Markdown projection emits: every
 * route, plus one parent-level alias per index route.
 *
 * @param pages Pages to project, defaulting to the publication manifest.
 * @returns The emitted paths, routes first.
 */
export function rawMarkdownFiles(pages: DocsPage[] = docsPages): string[] {
  const aliases = pages.map(page => indexAliasRoute(page.route)).filter(alias => alias !== undefined)
  return [...pages.map(page => page.route), ...aliases]
}

/**
 * The raw-Markdown twin of one published page.
 *
 * Frontmatter is VitePress rendering configuration and is dropped. A locale
 * home page therefore keeps its body here, while the rendered site truncates
 * it to the frontmatter redirect.
 *
 * @param markdown Rewritten canonical Markdown content.
 * @param source Repository-relative page source, named by frontmatter failures.
 * @returns Plain Markdown without frontmatter or repository chrome.
 */
export function rawMarkdownPageContent(markdown: string, source: string): string {
  return withoutRepositoryChrome(withoutFrontmatter(markdown, source))
}

/**
 * Raw Markdown served for one site route.
 *
 * Dev-server counterpart of {@link emitRawMarkdownPages}: images are not
 * copied because the generated tree already serves them beside the page.
 *
 * @param route Manifest route, including its `.md` suffix.
 * @param context Manifest and repository inputs, defaulting to this repository.
 * @returns The projected page, or `undefined` when the manifest does not publish the route.
 */
export function rawMarkdownRoute(route: string, context: ProjectionContext = defaultProjectionContext()): string | undefined {
  const page = context.pages.find(candidate => candidate.route === route)
  if (page === undefined) return undefined
  const markdown = readFileSync(resolve(context.repoRoot, page.source), 'utf8')
  return rawMarkdownPageContent(rewriteMarkdown(markdown, {
    sourcePath: page.source,
    locale: page.locale,
    route: page.route,
    pages: context.pages,
    repoRoot: context.repoRoot,
    repositoryRef: context.repositoryRef,
    placeImage: absPath => `./${encodeURI(basename(absPath))}`,
  }), page.source)
}
