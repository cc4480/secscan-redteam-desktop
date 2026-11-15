/** Sidecar `foo.i18n.yaml` pairing-record primitives; the module contract is in `translation-pairing.ts`. */

import { basename } from 'node:path'

const PAIR_META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

/**
 * Parse a `foo.i18n.yaml` consistency record into basename → recorded blob
 * hash, or undefined when any non-comment line deviates from the exact
 * `<basename>.md: <40-hex>` format or repeats a key. Consumers must
 * additionally require exactly the two expected basenames — a renamed key is
 * a malformed record, never a silently-missing entry.
 * @param content - Sidecar file text.
 * @returns The recorded map, or undefined for a malformed record.
 */
export function parsePairMeta(content: string): Map<string, string> | undefined {
  const out = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = PAIR_META_LINE.exec(line)
    if (!match?.[1] || !match[2]) return undefined
    if (out.has(match[1])) return undefined
    out.set(match[1], match[2])
  }
  return out
}

/**
 * Render a `foo.i18n.yaml` consistency record.
 * @param source - Repo-relative English path.
 * @param sourceHash - Blob hash of the English side.
 * @param zh - Repo-relative Chinese path.
 * @param zhHash - Blob hash of the Chinese side.
 * @returns The exact sidecar file content.
 */
export function renderPairMeta(source: string, sourceHash: string, zh: string, zhHash: string): string {
  return [
    '# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each',
    '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
    '# after editing either side, bring the other along and re-record with:',
    `#   pnpm run verify-translation-pairing --write ${source}`,
    `${basename(source)}: ${sourceHash}`,
    `${basename(zh)}: ${zhHash}`,
    '',
  ].join('\n')
}
