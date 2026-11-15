/**
 * Markdown link rewriting for the documentation projection: repository-relative
 * targets become site routes or repository URLs without reserializing the file.
 */

import { resolve } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Nodes } from 'mdast'
import type { DocsLocale, DocsPage } from '../website/docs.ts'
import {
  isExternalOrAbsoluteMarkdownUrl,
  markdownDestination,
  splitMarkdownUrlTarget,
} from './markdown.ts'
import {
  counterpartSource,
  githubTarget,
  repoPath,
  resolveRepositoryTarget,
  routeTarget,
} from './project-doc-site.paths.ts'

interface Replacement {
  start: number
  end: number
  value: string
}

type RewritableNode = Extract<Nodes, { type: 'link' | 'image' | 'definition' }>

/** Inputs for rewriting one canonical Markdown page. */
export interface RewriteMarkdownOptions {
  locale: DocsLocale
  sourcePath: string
  route: string
  pages: DocsPage[]
  repoRoot: string
  repositoryRef: string
  /**
   * Place one referenced image beside the projected page and return the URL to
   * reach it from that page. A GitHub raw URL cannot serve this repository —
   * `raw.githubusercontent.com` answers 404 for a private one, and no reader of
   * the site is authenticated to it — so an image travels into the generated
   * tree and Vite bundles it like any other site asset. Omitted by callers that
   * only rewrite text, which then leave images pointing at the repository.
   */
  placeImage?: (absPath: string) => string
}

function sourceMap(pages: DocsPage[]): Map<string, Map<DocsLocale, DocsPage>> {
  const map = new Map<string, Map<DocsLocale, DocsPage>>()
  for (const page of pages) {
    for (const source of [page.source, ...(page.sourceAliases ?? [])]) {
      const localized = map.get(source) ?? new Map<DocsLocale, DocsPage>()
      if (localized.has(page.locale)) {
        throw new Error(`project-doc-site: duplicate source or alias ${JSON.stringify(source)} for locale ${JSON.stringify(page.locale)}.`)
      }
      localized.set(page.locale, page)
      map.set(source, localized)
    }
  }
  return map
}

/**
 * Rewrite repository-relative links without reserializing Markdown.
 *
 * @param source Markdown text from the canonical file.
 * @param options Source, route, manifest, and repository context.
 * @returns Markdown whose published links resolve inside the site or to GitHub.
 */
export function rewriteMarkdown(source: string, options: RewriteMarkdownOptions): string {
  const sourceAbs = resolve(options.repoRoot, options.sourcePath)
  const published = sourceMap(options.pages)
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const replacements: Replacement[] = []

  const rewrite = (node: RewritableNode): void => {
    if (isExternalOrAbsoluteMarkdownUrl(node.url)) return
    const { path, suffix } = splitMarkdownUrlTarget(node.url)
    if (path === '') return
    const { absPath, line } = resolveRepositoryTarget(sourceAbs, path, options.repoRoot)
    const targetPath = repoPath(absPath, options.repoRoot)
    const isLanguageSwitcher = targetPath === counterpartSource(options.sourcePath)
    const targetLocale: DocsLocale = isLanguageSwitcher
      ? options.locale === 'root' ? 'en' : 'root'
      : options.locale
    const page = published.get(targetPath)?.get(targetLocale)
    const nextUrl = page !== undefined
      ? routeTarget(options.route, page.route, suffix)
      : node.type === 'image' && options.placeImage !== undefined
        // The suffix rides along exactly as the GitHub branch keeps it: an SVG
        // view fragment or a Vite query changes what the reference means.
        ? `${options.placeImage(absPath)}${suffix}`
        : githubTarget(absPath, line, suffix, options.repositoryRef, options.repoRoot, node.type === 'image')

    const destination = markdownDestination(source, node)
    replacements.push({
      start: destination.start,
      end: destination.end,
      value: nextUrl,
    })
  }

  const visit = (node: Nodes): void => {
    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && 'url' in node) rewrite(node)
    if ('children' in node) {
      for (const child of node.children) visit(child)
    }
  }
  visit(tree)

  let projected = source
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    projected = projected.slice(0, replacement.start) + replacement.value + projected.slice(replacement.end)
  }
  return projected
}
