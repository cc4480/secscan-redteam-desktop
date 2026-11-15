/** Repository path resolution for bilingual Markdown link targets. */

import { existsSync, statSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { isExternalOrAbsoluteMarkdownUrl, splitMarkdownUrlTarget } from './markdown.ts'

/** Repository and source document used to resolve one relative link. */
export interface TranslationLinkContext {
  /** Absolute repository root. */
  repoRoot: string
  /** Repository-relative Markdown source path. */
  sourcePath: string
  /** Whether an English Markdown path belongs to the active bilingual corpus. */
  isTranslationPairSource: (sourcePath: string) => boolean
  /** Selected content plane; defaults to regular files in the working tree. */
  repositoryFileExists?: (repoPath: string) => boolean
}

/** One relative document link whose target uses the wrong locale sibling. */
export interface TranslationLinkLocaleViolation {
  sourcePath: string
  line: number
  url: string
  expectedUrl: string
}

/** Result of rewriting wrong-locale relative document links. */
export interface TranslationLinkRewriteResult {
  content: string
  rewritten: number
}

interface TranslationPairTarget {
  source: string
  zh: string
}

/** One authored link resolved to the pair, suffix, and locale its source demands. */
export interface ResolvedTranslationLink {
  pair: TranslationPairTarget
  targetPath: string
  suffix: string
  expectedPath: string
  expectedUrl: string
  locale: 'en' | 'zh'
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function worktreeFileExists(repoRoot: string, repoPath: string): boolean {
  try {
    const path = resolve(repoRoot, repoPath)
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

function repositoryFileExists(context: TranslationLinkContext, repoPath: string): boolean {
  return context.repositoryFileExists?.(repoPath) ?? worktreeFileExists(context.repoRoot, repoPath)
}

function repositoryRelativePath(path: string): string | undefined {
  const normalized = posix.normalize(path)
  if (normalized === '' || normalized === '.' || normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)) {
    return undefined
  }
  return normalized
}

function resolveRepositoryTarget(
  rawPath: string,
  context: TranslationLinkContext,
): string | undefined {
  const decoded = decodePath(rawPath)
  const exact = repositoryRelativePath(posix.join(posix.dirname(context.sourcePath), decoded))
  if (exact === undefined) return undefined
  return repositoryFileExists(context, exact) ? exact : undefined
}

function translationPairTarget(targetPath: string, context: TranslationLinkContext): TranslationPairTarget | undefined {
  const source = targetPath.endsWith('.zh.md')
    ? targetPath.replace(/\.zh\.md$/, '.md')
    : targetPath.endsWith('.md') ? targetPath : undefined
  if (source === undefined || !context.isTranslationPairSource(source)) return undefined
  const zh = source.replace(/\.md$/, '.zh.md')
  return { source, zh }
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, character => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ))
}

function relativeExpectedPath(
  context: TranslationLinkContext,
  expectedPath: string,
  rawPath: string,
): string {
  const relative = posix.relative(posix.dirname(context.sourcePath), expectedPath)
  const encoded = relative.split('/').map(encodePathSegment).join('/')
  return rawPath.startsWith('./') && !encoded.startsWith('.') ? `./${encoded}` : encoded
}

function expectedLocalePath(
  rawPath: string,
  locale: 'en' | 'zh',
  context: TranslationLinkContext,
  expectedPath: string,
): string {
  if (locale === 'zh' && rawPath.endsWith('.md') && !rawPath.endsWith('.zh.md')) {
    return rawPath.replace(/\.md$/, '.zh.md')
  }
  if (locale === 'en' && rawPath.endsWith('.zh.md')) return rawPath.replace(/\.zh\.md$/, '.md')
  return relativeExpectedPath(context, expectedPath, rawPath)
}

/** Resolve one authored URL to its pair and to the path the source locale requires. */
export function resolveTranslationLink(
  url: string,
  context: TranslationLinkContext,
  authoredUrl: string,
): ResolvedTranslationLink | undefined {
  if (isExternalOrAbsoluteMarkdownUrl(url)) return undefined
  const { path } = splitMarkdownUrlTarget(url)
  const authored = splitMarkdownUrlTarget(authoredUrl)
  if (path === '') return undefined
  const targetPath = resolveRepositoryTarget(path, context)
  if (targetPath === undefined) return undefined
  const pair = translationPairTarget(targetPath, context)
  if (pair === undefined) return undefined
  const locale = context.sourcePath.endsWith('.zh.md') ? 'zh' : 'en'
  const expectedPath = locale === 'zh' ? pair.zh : pair.source
  return {
    pair,
    targetPath,
    suffix: authored.suffix,
    expectedPath,
    expectedUrl: `${expectedLocalePath(authored.path, locale, context, expectedPath)}${authored.suffix}`,
    locale,
  }
}

/** Whether a resolved link already names the sibling its source locale requires. */
export function hasExpectedLocale(resolved: ResolvedTranslationLink): boolean {
  return resolved.targetPath === resolved.expectedPath
}
