/** Detection of the canonical top-level language switcher paragraph. */

import type { Nodes } from 'mdast'

/** Offset of the one top-level switcher link immediately following the H1. */
export function languageSwitcherLinkOffset(
  tree: Nodes,
  markdown: string,
  acceptedTargets: string | readonly string[],
): number | undefined {
  if (tree.type !== 'root') return undefined
  const accepted = new Set(typeof acceptedTargets === 'string' ? [acceptedTargets] : acceptedTargets)
  const headingIndex = tree.children.findIndex(node => node.type === 'heading' && node.depth === 1)
  if (headingIndex < 0) return undefined
  for (const node of tree.children.slice(headingIndex + 1)) {
    if (node.type === 'heading') return undefined
    if (node.type !== 'paragraph' || node.position === undefined) continue
    const start = node.position.start.offset
    const end = node.position.end.offset
    if (start === undefined || end === undefined) continue
    const authored = markdown.slice(start, end)
    if (!/^(?:English \| \[中文\]\([^\n]+\)|\[English\]\([^\n]+\) \| 中文)$/.test(authored)) continue
    const links = node.children.filter((child): child is Extract<Nodes, { type: 'link' }> => child.type === 'link')
    if (links.length === 1 && accepted.has(links[0]?.url ?? '')) {
      return links[0]?.position?.start.offset
    }
  }
  return undefined
}

/** Whether the tree carries its canonical top-level language switcher. */
export function hasLanguageSwitcher(
  tree: Nodes,
  markdown: string,
  acceptedTargets: string | readonly string[],
): boolean {
  return languageSwitcherLinkOffset(tree, markdown, acceptedTargets) !== undefined
}
