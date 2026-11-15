/**
 * Repository path resolution and published-target selection for the
 * documentation projection, shared by the sibling projection modules.
 */

import { existsSync, lstatSync } from 'node:fs'
import { dirname, extname, posix, relative, resolve, sep } from 'node:path'

const REPOSITORY_URL = 'https://github.com/deepseek-ai/deepseek-harness'

/**
 * Express an absolute path relative to the repository root, with `/` separators.
 * @param absPath Absolute path to express.
 * @param repoRoot Repository root the path is relative to.
 * @returns The repository-relative path.
 */
export function repoPath(absPath: string, repoRoot: string): string {
  return relative(repoRoot, absPath).split(sep).join('/')
}

/**
 * Decode the percent escapes of a Markdown link target.
 *
 * `#fragment` suffixes pass through verbatim. Generated cordis-surface headings
 * carry explicit `<a id>` anchors with the GitHub slug, so those fragments
 * resolve on the published site too; hand-written headings rely on VitePress's
 * own slugger, which differs from GitHub's for punctuation-heavy text —
 * hand-authored cross-page fragments should prefer plain-text headings or
 * explicit anchors.
 *
 * @param path Link target as written.
 * @returns The decoded path.
 */
export function decodePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    throw new Error(`project-doc-site: malformed percent escape in ${JSON.stringify(path)}.`)
  }
}

/**
 * Relative URL from one published route to another.
 * @param fromRoute Route the link is written on.
 * @param toRoute Route the link reaches.
 * @param suffix Query or fragment suffix carried over verbatim.
 * @returns The relative URL, prefixed with `./` when it does not already start with a dot.
 */
export function routeTarget(fromRoute: string, toRoute: string, suffix: string): string {
  const target = posix.relative(posix.dirname(fromRoute), toRoute)
  return `${target.startsWith('.') ? target : `./${target}`}${suffix}`
}

/**
 * The same page in the other locale's source tree.
 * @param source Repository-relative page source.
 * @returns The counterpart source path.
 */
export function counterpartSource(source: string): string {
  return source.endsWith('.zh.md')
    ? source.replace(/\.zh\.md$/, '.md')
    : source.replace(/\.md$/, '.zh.md')
}

/**
 * Resolve a repository link target to the file it names.
 *
 * A target resolves directly, as `<target>:<line>`, or — when it carries no
 * extension — as a sibling Markdown file or a directory index.
 *
 * @param sourceAbs Absolute path of the linking page.
 * @param rawPath Link target as written.
 * @param repoRoot Repository root, named by the failure.
 * @returns The resolved absolute path, plus the line number when the target names one.
 */
export function resolveRepositoryTarget(sourceAbs: string, rawPath: string, repoRoot: string): { absPath: string; line?: number } {
  const decoded = decodePath(rawPath)
  let absPath = resolve(dirname(sourceAbs), decoded)
  if (existsSync(absPath)) return { absPath }

  const lineMatch = decoded.match(/:(\d+)$/)
  if (lineMatch !== null) {
    const lineText = lineMatch[1]
    if (lineText === undefined) throw new Error('project-doc-site: line suffix matched without a line number.')
    absPath = resolve(dirname(sourceAbs), decoded.slice(0, -lineMatch[0].length))
    if (existsSync(absPath)) return { absPath, line: Number.parseInt(lineText, 10) }
  }

  if (extname(decoded) === '') {
    const markdown = resolve(dirname(sourceAbs), `${decoded}.md`)
    if (existsSync(markdown)) return { absPath: markdown }
    const index = resolve(dirname(sourceAbs), decoded, 'index.md')
    if (existsSync(index)) return { absPath: index }
  }

  throw new Error(`project-doc-site: ${repoPath(sourceAbs, repoRoot)} links to missing path ${JSON.stringify(rawPath)}.`)
}

/**
 * Repository URL for one link target.
 * @param absPath Resolved target.
 * @param line Line number the link names, when any.
 * @param suffix Query or fragment suffix carried over verbatim.
 * @param repositoryRef Public ref the URL points at.
 * @param repoRoot Repository root the target is relative to.
 * @param image Whether the target is an image, which GitHub serves raw.
 * @returns The absolute URL.
 */
export function githubTarget(
  absPath: string,
  line: number | undefined,
  suffix: string,
  repositoryRef: string,
  repoRoot: string,
  image: boolean,
): string {
  const path = repoPath(absPath, repoRoot)
  if (image) return `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${repositoryRef}/${path}${suffix}`
  const kind = lstatSync(absPath).isDirectory() ? 'tree' : 'blob'
  const lineSuffix = line === undefined ? suffix : `#L${line}`
  return `${REPOSITORY_URL}/${kind}/${repositoryRef}/${path}${lineSuffix}`
}
