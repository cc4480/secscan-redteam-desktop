/** Field-level parsers and predicates shared by the Model Experience entry checks. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Validate H5-plus-markdown literals nested under one Model Experience field. */
export function validateNestedVerbatim(raw: readonly string[], fragments: Set<string>): { blocks: number; error?: string } {
  let cursor = 0
  while (raw[cursor]?.trim().length === 0) cursor += 1
  if (cursor === raw.length) return { blocks: 0 }

  let blocks = 0
  while (true) {
    while (raw[cursor]?.trim().length === 0) cursor += 1
    if (cursor === raw.length) break
    if (!/^##### \S/.test(raw[cursor] ?? '')) {
      return { blocks, error: 'content after a field paragraph must be a titled H5 verbatim block' }
    }
    const title = (raw[cursor] as string).slice('##### '.length)
    const fragment = headingFragment(title)
    if (fragment.length === 0) return { blocks, error: 'verbatim H5 title must be non-empty' }
    if (fragments.has(fragment)) {
      return { blocks, error: `verbatim H5 title ${JSON.stringify(title)} is duplicated within its model-context entry` }
    }
    fragments.add(fragment)
    cursor += 1
    while (raw[cursor]?.trim().length === 0) cursor += 1
    if (raw[cursor] !== '```markdown') {
      return { blocks, error: 'each nested verbatim H5 requires an exact ```markdown fence' }
    }
    cursor += 1
    const contentStart = cursor
    while (cursor < raw.length && raw[cursor] !== '```') cursor += 1
    if (cursor === raw.length) return { blocks, error: 'unterminated nested ```markdown fence' }
    if (cursor === contentStart) return { blocks, error: 'nested ```markdown fence must not be empty' }
    cursor += 1
    blocks += 1
  }
  return { blocks }
}

/** GitHub-style fragment for the simple ASCII nested titles allowed by these rules. */
export function headingFragment(title: string): string {
  return title.toLowerCase().replaceAll('`', '').replaceAll(/[^a-z0-9 _-]/g, '').trim().replaceAll(/\s+/g, '-')
}

/** A direct stable system-prompt contribution, as named by the README rules. */
export function isDirectSystemPromptEntry(title: string): boolean {
  return /\bsystem prompt\b/i.test(title)
}

/** Anchored generated-catalog links in one model-view field. */
export function toolCatalogLinkFragments(text: string): string[] {
  return [...text.matchAll(/\]\(\.\.\/\.\.\/\.\.\/docs\/tool-catalog\.md#([a-z0-9_-]+)\)/g)]
    .map(match => match[1] as string)
}

/**
 * Read the H2 title fragments `docs/tool-catalog.md` offers as link anchors.
 * @param root - repository root the catalog path resolves against.
 * @returns every anchored H2 fragment the catalog declares.
 */
export function loadToolCatalogFragments(root: string): Set<string> {
  const toolCatalogFragments = new Set<string>()
  for (const line of readFileSync(resolve(root, 'docs/tool-catalog.md'), 'utf8').split('\n')) {
    const title = /^## (.+)$/.exec(line)?.[1]
    if (title !== undefined) toolCatalogFragments.add(headingFragment(title))
  }
  return toolCatalogFragments
}
