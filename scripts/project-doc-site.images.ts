/**
 * Image publication for the documentation projection: which references may be
 * copied into the site, and the source files the dev server watches.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { docsPages } from '../website/docs.ts'
import { root } from './project-doc-site.context.ts'
import { rewriteMarkdown } from './project-doc-site.rewrite.ts'

/**
 * The repository file one image reference resolves to, or `undefined` when the
 * target is not a local file this build may publish.
 * @param absPath - resolved image target.
 * @param repoRoot - repository root every published image must stay inside.
 * @returns the file's real path, or `undefined` when it must not be copied.
 *
 * Only a regular file whose real path stays inside the repository qualifies.
 * Publication copies the bytes into the site, so a reference escaping the
 * repository — `../../.ssh/id_rsa`, or a symlink pointing out of the tree —
 * would put a build-machine file on the site; `existsSync` alone, which is all
 * link resolution needs, does not answer that.
 */
export function publishableImage(absPath: string, repoRoot: string): string | undefined {
  const real = realpathSync(absPath)
  const inside = real === repoRoot || real.startsWith(`${repoRoot}${sep}`)
  return inside && statSync(real).isFile() ? real : undefined
}

/** Every local image a published page references, resolved to its repository file. */
function referencedImages(): string[] {
  const found = new Set<string>()
  for (const page of docsPages) {
    const sourceAbs = resolve(root, page.source)
    if (!existsSync(sourceAbs)) continue
    rewriteMarkdown(readFileSync(sourceAbs, 'utf8'), {
      sourcePath: page.source,
      locale: page.locale,
      route: page.route,
      pages: docsPages,
      repoRoot: root,
      repositoryRef: 'master',
      placeImage: (absPath) => {
        const real = publishableImage(absPath, root)
        if (real !== undefined) found.add(real)
        return ''
      },
    })
  }
  return [...found]
}

/**
 * Files watched by the local VitePress dev server: every canonical Markdown
 * source, plus the images they publish. Without the images, replacing a
 * screenshot leaves the previous copy in the generated tree until something
 * touches the Markdown beside it.
 */
export function docsSourceFiles(): string[] {
  return [...new Set([...docsPages.map(page => resolve(root, page.source)), ...referencedImages()])]
}
