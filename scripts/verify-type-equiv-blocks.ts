/** Extraction of `ts type-equiv` and `ts public-api` fences from one Markdown document. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { markdownFences } from './markdown.ts'
import { repoRoot, type EquivBlock } from './verify-type-equiv-model.ts'
import { blockSymbol } from './verify-type-equiv-normalize.ts'

/** Extract every source-equivalence block from one Markdown file. */
export function extractEquivBlocks(docRel: string): EquivBlock[] {
  const blocks: EquivBlock[] = []
  for (const fence of markdownFences(readFileSync(resolve(repoRoot, docRel), 'utf8'))) {
    if (fence.info === 'ts type-equiv public-api') {
      throw new Error(`verify-type-equiv: ${docRel}:${fence.line} — use the concise \`ts public-api\` fence`)
    }
    if (fence.info !== 'ts type-equiv' && fence.info !== 'ts public-api') continue
    if (!fence.closed) {
      throw new Error(`verify-type-equiv: ${docRel}:${fence.line} — unterminated type-equivalence fence (missing closing \`\`\`)`)
    }
    const symbol = blockSymbol(fence.code)
    if (symbol === null) {
      throw new Error(`verify-type-equiv: ${docRel}:${fence.line} — type-equiv block has no parseable interface/type/class declaration`)
    }
    blocks.push({
      doc: docRel,
      line: fence.line,
      symbol,
      code: fence.code,
      ...(fence.info === 'ts public-api' ? { projection: 'public-api' as const } : {}),
    })
  }
  return blocks
}
