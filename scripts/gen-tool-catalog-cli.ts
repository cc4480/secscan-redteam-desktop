/**
 * CLI body for the tool-catalog generator: writes the catalog, or with
 * `--check` compares it byte for byte against the committed copy.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collectToolCatalog } from './gen-tool-catalog-collect.ts'
import { render } from './gen-tool-catalog-render.ts'
import { OUT, root } from './gen-tool-catalog-support.ts'

/** CLI entry: default writes the catalog, `--check` fails if the committed copy
 * is stale. The barrel guards the call behind an entry-point check so importing
 * it for tests neither regenerates the committed file nor calls process.exit. */
export async function main(): Promise<void> {
  const content = render(await collectToolCatalog())
  if (process.argv.includes('--check')) {
    let committed: string | null = null
    try {
      committed = readFileSync(resolve(root, OUT), 'utf8')
    } catch {
      // Only ENOENT (not yet generated) is expected; a present-but-unreadable
      // file is not a state this repo produces. Either way the remedy is the
      // same — regenerate — so treat a read failure as "stale".
      committed = null
    }
    if (committed === content) {
      console.log(`gen-tool-catalog: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-tool-catalog: ${OUT} is stale. Run \`pnpm run gen-tool-catalog\` and commit ${OUT}.`)
    const committedLines = committed?.split('\n') ?? []
    const generatedLines = content.split('\n')
    const lineCount = Math.max(committedLines.length, generatedLines.length)
    for (let index = 0; index < lineCount; index += 1) {
      if (committedLines[index] === generatedLines[index]) continue
      console.error(`gen-tool-catalog: first difference at line ${index + 1}`)
      console.error(`  committed: ${JSON.stringify(committedLines[index])}`)
      console.error(`  generated: ${JSON.stringify(generatedLines[index])}`)
      break
    }
    process.exit(1)
  }

  writeFileSync(resolve(root, OUT), content)
  console.log(`gen-tool-catalog: wrote ${OUT}.`)
}
