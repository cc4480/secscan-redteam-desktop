/** Violation reporting, byte-preserving rewriting, and semantic targets for bilingual links. */

import type { Nodes } from 'mdast'
import {
  isExternalOrAbsoluteMarkdownUrl,
  markdownDestination,
  parseMarkdown,
  visitMarkdown,
  type MarkdownDestination,
} from './markdown.ts'
import {
  hasExpectedLocale,
  resolveTranslationLink,
  type ResolvedTranslationLink,
  type TranslationLinkContext,
  type TranslationLinkLocaleViolation,
  type TranslationLinkRewriteResult,
} from './translation-links-context.ts'
import { languageSwitcherLinkOffset } from './translation-links-switcher.ts'

interface Replacement {
  start: number
  end: number
  value: string
}

type LinkNode = Extract<Nodes, { type: 'link' | 'definition' }>

function replacementFor(destination: MarkdownDestination, value: string): Replacement {
  return { start: destination.start, end: destination.end, value }
}

function authoredExternalTarget(markdown: string, node: LinkNode): string {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) {
    throw new Error(`translation-links: external link ${JSON.stringify(node.url)} has no source offsets`)
  }
  const raw = markdown.slice(start, end)
  if (node.type === 'definition' || raw.startsWith('[')) return markdownDestination(markdown, node).url
  if (raw.startsWith('<') && raw.endsWith('>')) return raw.slice(1, -1)
  return raw
}

function applyReplacements(markdown: string, replacements: Replacement[]): string {
  let output = markdown
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
  return output
}

function visitDocumentLinkNodes(
  markdown: string,
  skipTargets: readonly string[],
  visitor: (node: LinkNode) => void,
): void {
  const tree = parseMarkdown(markdown)
  const switcherOffset = languageSwitcherLinkOffset(tree, markdown, skipTargets)
  const referencedIdentifiers = new Set<string>()
  const visitedDefinitions = new Set<string>()
  visitMarkdown(tree, (node) => {
    if (node.type === 'linkReference') referencedIdentifiers.add(node.identifier)
  })
  visitMarkdown(tree, (node) => {
    if (node.type === 'link' && node.position?.start.offset === switcherOffset) return
    if (node.type === 'link') {
      visitor(node)
    } else if (node.type === 'definition'
      && referencedIdentifiers.has(node.identifier)
      && !visitedDefinitions.has(node.identifier)) {
      visitedDefinitions.add(node.identifier)
      visitor(node)
    }
  })
}

function visitResolvedDocumentLinks(
  markdown: string,
  context: TranslationLinkContext,
  skipTargets: readonly string[],
  visitor: (node: LinkNode, destination: MarkdownDestination, resolved: ResolvedTranslationLink) => void,
): void {
  visitDocumentLinkNodes(markdown, skipTargets, (node) => {
    if (isExternalOrAbsoluteMarkdownUrl(node.url)) return
    const destination = markdownDestination(markdown, node)
    const resolved = resolveTranslationLink(node.url, context, destination.url)
    if (resolved !== undefined) visitor(node, destination, resolved)
  })
}

/** Return one violation per wrong-locale link or link definition. */
export function translationLinkLocaleViolations(
  markdown: string,
  context: TranslationLinkContext,
  skipTargets: readonly string[] = [],
): TranslationLinkLocaleViolation[] {
  const violations: TranslationLinkLocaleViolation[] = []
  visitResolvedDocumentLinks(markdown, context, skipTargets, (node, destination, resolved) => {
    if (hasExpectedLocale(resolved)) return
    violations.push({
      sourcePath: context.sourcePath,
      line: node.position?.start.line ?? 0,
      url: destination.url,
      expectedUrl: resolved.expectedUrl,
    })
  })
  return violations
}

/** Rewrite wrong-locale document links without reserializing surrounding Markdown. */
export function rewriteTranslationLinkLocales(
  markdown: string,
  context: TranslationLinkContext,
  skipTargets: readonly string[] = [],
): TranslationLinkRewriteResult {
  const replacements: Replacement[] = []
  visitResolvedDocumentLinks(markdown, context, skipTargets, (_node, destination, resolved) => {
    if (hasExpectedLocale(resolved)) return
    replacements.push(replacementFor(destination, resolved.expectedUrl))
  })
  return { content: applyReplacements(markdown, replacements), rewritten: replacements.length }
}

/** Normalize only paired-document locale paths while retaining every other byte and URL suffix. */
export function normalizeTranslationMarkdownLinks(
  markdown: string,
  context: TranslationLinkContext,
  skipTargets: readonly string[] = [],
): string {
  const replacements: Replacement[] = []
  visitResolvedDocumentLinks(markdown, context, skipTargets, (_node, destination, resolved) => {
    replacements.push(replacementFor(
      destination,
      `dsh-translation-target:${resolved.pair.source}${resolved.suffix}`,
    ))
  })
  return applyReplacements(markdown, replacements)
}

/** Semantic target of one authored inline link or referenced definition. */
export function semanticTranslationLinkNodeTarget(
  node: LinkNode,
  markdown: string,
  context: TranslationLinkContext,
): string {
  if (isExternalOrAbsoluteMarkdownUrl(node.url)) return authoredExternalTarget(markdown, node)
  const destination = markdownDestination(markdown, node)
  const resolved = resolveTranslationLink(node.url, context, destination.url)
  return resolved === undefined
    ? destination.url
    : `dsh-translation-target:${resolved.pair.source}${resolved.suffix}`
}
