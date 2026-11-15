/**
 * Projection passes that write a page tree: the generated VitePress source tree
 * and the raw-Markdown twin emitted into a built site.
 */

import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import type { DocsPage } from '../website/docs.ts'
import { defaultProjectionContext, generatedRoot, type ProjectionContext } from './project-doc-site.context.ts'
import { publishableImage } from './project-doc-site.images.ts'
import { addProjectionFrontmatter, projectedPageContent } from './project-doc-site.page-content.ts'
import { repoPath } from './project-doc-site.paths.ts'
import { indexAliasRoute, rawMarkdownPageContent } from './project-doc-site.raw-markdown.ts'
import { rewriteMarkdown } from './project-doc-site.rewrite.ts'

/**
 * Project every page and its images into one target tree.
 *
 * `entries` are what gets emitted; link resolution always reads the canonical
 * `context.pages`, so an alias entry sharing a source with its index route
 * emits at its own path while links keep targeting canonical routes.
 */
function projectPagesInto(
  targetRoot: string,
  context: ProjectionContext,
  pageContent: (markdown: string, page: DocsPage) => string,
  entries: DocsPage[] = context.pages,
): void {
  const routes = new Set<string>()
  /** Projected path to the repository file that claimed it, pages and images alike. */
  const claimed = new Map<string, string>()

  /** Reserve one projected path, refusing a second source for it. */
  const claim = (target: string, sourceAbs: string): void => {
    const holder = claimed.get(target)
    if (holder !== undefined && holder !== sourceAbs) {
      throw new Error(
        `project-doc-site: ${repoPath(sourceAbs, context.repoRoot)} and ${repoPath(holder, context.repoRoot)}`
        + ` both project to ${relative(targetRoot, target).split(sep).join('/')}.`,
      )
    }
    // A file the projection did not claim is another producer's output — in
    // the twin pass, the build VitePress just wrote, including `public/`
    // copies. Overwriting one would silently corrupt the site.
    if (holder === undefined && existsSync(target)) {
      throw new Error(
        `project-doc-site: ${repoPath(sourceAbs, context.repoRoot)} would overwrite existing build file`
        + ` ${relative(targetRoot, target).split(sep).join('/')}.`,
      )
    }
    claimed.set(target, sourceAbs)
  }

  for (const page of entries) {
    if (routes.has(page.route)) throw new Error(`project-doc-site: duplicate route ${JSON.stringify(page.route)}.`)
    routes.add(page.route)
    const sourceAbs = resolve(context.repoRoot, page.source)
    if (!existsSync(sourceAbs) || !lstatSync(sourceAbs).isFile()) {
      throw new Error(`project-doc-site: source ${JSON.stringify(page.source)} does not exist or is not a file.`)
    }
    const output = resolve(targetRoot, page.route)
    // Claimed before the images are placed: a page and an image landing on one
    // path would otherwise overwrite each other in whichever order they ran.
    claim(output, sourceAbs)
    mkdirSync(dirname(output), { recursive: true })
    const markdown = readFileSync(sourceAbs, 'utf8')
    const projected = rewriteMarkdown(markdown, {
      sourcePath: page.source,
      locale: page.locale,
      route: page.route,
      pages: context.pages,
      repoRoot: context.repoRoot,
      repositoryRef: context.repositoryRef,
      placeImage: (absPath) => {
        const real = publishableImage(absPath, context.repoRoot)
        if (real === undefined) {
          throw new Error(
            `project-doc-site: ${page.source} references image ${repoPath(absPath, context.repoRoot)},`
            + ' which is not a regular file inside the repository.',
          )
        }
        // Beside the page that references it, under its own basename: each
        // locale's route tree gets its own copy, so one relative URL is correct
        // from both.
        const name = basename(real)
        const target = resolve(dirname(output), name)
        claim(target, real)
        copyFileSync(real, target)
        // Encoded because the destination is a Markdown inline target, where an
        // unescaped space would end it early.
        return `./${encodeURI(name)}`
      },
    })
    writeFileSync(output, pageContent(projected, page))
  }
}

/** Rebuild the disposable VitePress source tree from the publication manifest. */
export function projectDocs(): void {
  rmSync(generatedRoot, { recursive: true, force: true })
  projectPagesInto(generatedRoot, defaultProjectionContext(), (markdown, page) =>
    addProjectionFrontmatter(projectedPageContent(markdown, page), page))
}

/**
 * Emit the raw-Markdown twin of every published route into a built site, so
 * static hosting serves the page's URL, minus any trailing slash, plus `.md`
 * as plain Markdown. Each index route also emits a parent-level alias twin,
 * projected over the alias route so its relative links stay correct.
 * Referenced images are copied beside the pages, keeping the same relative
 * URLs valid in both trees. Existing build files stay in place, and a name
 * collision with one fails the emission. Markdown files carry a UTF-8 BOM so
 * browser navigation decodes them even when static hosting omits a charset.
 *
 * @param outDir Build output directory to emit into.
 * @param context Manifest and repository inputs, defaulting to this repository.
 */
export function emitRawMarkdownPages(outDir: string, context: ProjectionContext = defaultProjectionContext()): void {
  const aliases = context.pages.flatMap((page) => {
    const alias = indexAliasRoute(page.route)
    return alias === undefined ? [] : [{ ...page, route: alias }]
  })
  projectPagesInto(
    outDir,
    context,
    (markdown, page) => `\uFEFF${rawMarkdownPageContent(markdown, page.source)}`,
    [...context.pages, ...aliases],
  )
}
