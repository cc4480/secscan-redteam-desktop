/** Structural signature comparison between the two sides of a pair; the module contract is in `translation-pairing.ts`. */

import { basename } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Nodes } from 'mdast'
import {
  languageSwitcherLinkOffset,
  semanticTranslationLinkNodeTarget,
  type TranslationLinkContext,
} from './translation-links.ts'

/** The structural signature compared between the two sides of a pair. */
export interface TranslationStructureSignature {
  /** Heading depths in document order (h2 -> 2). */
  headings: number[]
  /** Fenced code blocks verbatim: info string plus content, in order. */
  code: string[]
  /** Row and column count of each table, in order. */
  tables: string[]
  /** Kind, ordered-list start, and direct item count of each list, in order. */
  lists: string[]
  /** Every link target in order; the language switcher is excluded. */
  links: string[]
}

/** Parse Markdown with the same GFM extensions used by the pairing gate. */
export function parseTranslationMarkdown(content: string): Nodes {
  return fromMarkdown(content, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

const PUBLIC_REPOSITORY_BLOB_ROOT = 'https://github.com/deepseek-ai/deepseek-harness/blob/master/'

/** Return the accepted relative and public-repository links to one counterpart. */
export function languageSwitcherTargets(counterpart: string): string[] {
  return [basename(counterpart), `${PUBLIC_REPOSITORY_BLOB_ROOT}${counterpart}`]
}

/** Generated English sources cannot carry a switcher without making their generator stale. */
export function requiresSourceLanguageSwitcher(source: string): boolean {
  return ![
    'docs/agent-lifecycle.md',
    'docs/capability-seams.md',
    'docs/config-catalog.md',
    'docs/cordis-api/context.md',
    'docs/cordis-api/events.md',
    'docs/cordis-api/fiber.md',
    // Excluded from pairing, but kept here for generated-category completeness and direct spec coverage.
    'docs/cordis-api/inherited.md',
    'docs/cordis-api/registry.md',
    'docs/cordis-api/service.md',
    'docs/event-producer-consumer.md',
    'docs/graph-atlas.md',
    'docs/module-graph.md',
    'docs/persistence-catalog.md',
    'docs/tool-catalog.md',
    'docs/tool-execution-pipeline.md',
  ].includes(source)
}

/** Collect the ordered structural signature, skipping accepted switcher targets. */
export function translationStructureSignature(
  tree: Nodes,
  switcherTargets: string | readonly string[],
  linkContext: TranslationLinkContext & { markdown: string },
): TranslationStructureSignature {
  const switcherOffset = languageSwitcherLinkOffset(tree, linkContext.markdown, switcherTargets)
  const sig: TranslationStructureSignature = { headings: [], code: [], tables: [], lists: [], links: [] }
  const definitions = new Map<string, Extract<Nodes, { type: 'definition' }>>()
  const collectDefinitions = (node: Nodes): void => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node)
    }
    if ('children' in node) for (const child of node.children) collectDefinitions(child)
  }
  collectDefinitions(tree)
  const linkTarget = (node: Extract<Nodes, { type: 'link' | 'definition' }>): string => (
    semanticTranslationLinkNodeTarget(node, linkContext.markdown, linkContext)
  )
  const visit = (node: Nodes): void => {
    switch (node.type) {
      case 'heading':
        sig.headings.push(node.depth)
        break
      case 'code':
        sig.code.push(`\`\`\`${node.lang ?? ''}${node.meta ? ` ${node.meta}` : ''}\n${node.value}`)
        break
      case 'table':
        sig.tables.push(`${node.children.length}x${node.children[0]?.children.length ?? 0}`)
        break
      case 'list':
        sig.lists.push(node.ordered
          ? `ordered:start=${node.start ?? 1}:items=${node.children.length}`
          : `bullet:items=${node.children.length}`)
        break
      case 'link':
        if (node.position?.start.offset !== switcherOffset) {
          sig.links.push(linkTarget(node))
        }
        break
      case 'linkReference': {
        const definition = definitions.get(node.identifier)
        if (definition !== undefined) {
          sig.links.push(linkTarget(definition))
        }
        break
      }
      default:
        // Every other node kind is prose or a container, not part of the signature.
        break
    }
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(tree)
  return sig
}

/** Render a signature element for an error message, truncated for readability. */
function show(value: string | number | undefined): string {
  if (value === undefined) return 'nothing'
  const text = JSON.stringify(value)
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

/** Return the first divergence for each structural field; empty means equal. */
export function translationStructureDiff(
  source: TranslationStructureSignature,
  zh: TranslationStructureSignature,
): string[] {
  const out: string[] = []
  const fields: [string, (string | number)[], (string | number)[]][] = [
    ['heading (depth)', source.headings, zh.headings],
    ['code block', source.code, zh.code],
    ['table (row x column count)', source.tables, zh.tables],
    ['list (kind, start, item count)', source.lists, zh.lists],
    ['link target', source.links, zh.links],
  ]
  for (const [field, sourceValues, zhValues] of fields) {
    const length = Math.max(sourceValues.length, zhValues.length)
    for (let index = 0; index < length; index++) {
      if (sourceValues[index] !== zhValues[index]) {
        out.push(`${field} #${index + 1} diverges between the pair: ${show(sourceValues[index])} vs ${show(zhValues[index])}`)
        break
      }
    }
  }
  return out
}
