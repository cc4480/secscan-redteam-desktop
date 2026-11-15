/**
 * CLI entry for the third-party-notice generator: writes the artifact by
 * default, or verifies the committed copy under `--check`.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OUT, root } from './gen-third-party-notices-shared.ts'
import { render } from './gen-third-party-notices-render.ts'

/** CLI entry: default writes the notices, `--check` fails if the committed copy
 * is stale. Guarded behind an entry-point check so importing this module for
 * tests neither regenerates the committed file nor calls process.exit. */
export async function main(): Promise<void> {
  const content = await render()
  if (process.argv.includes('--check')) {
    let committed: string | null = null
    try {
      committed = readFileSync(resolve(root, OUT), 'utf8')
    } catch {
      // Only ENOENT (not yet generated) is expected; a present-but-unreadable
      // file is not a state this repo produces, and the remedy is the same.
      committed = null
    }
    if (committed === content) {
      console.log(`gen-third-party-notices: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-third-party-notices: ${OUT} is stale. Run \`pnpm run gen-third-party-notices\` and commit ${OUT}.`)
    process.exit(1)
  }

  writeFileSync(resolve(root, OUT), content)
  console.log(`gen-third-party-notices: wrote ${OUT}.`)
}
