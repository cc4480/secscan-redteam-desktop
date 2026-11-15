import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collectConfigCatalog } from './gen-config-catalog-collect.ts'
import { render } from './gen-config-catalog-render.ts'
import { OUT, root } from './gen-config-catalog-root.ts'

/** CLI entry: default writes the catalog, `--check` fails if the committed
 * copy is stale. Guarded behind an entry-point check so importing this module
 * for tests neither regenerates the committed file nor calls process.exit. */
export function main(): void {
  const content = render(collectConfigCatalog())
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
      console.log(`gen-config-catalog: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-config-catalog: ${OUT} is stale. Run \`pnpm run gen-config-catalog\` and commit ${OUT}.`)
    process.exit(1)
  }
  writeFileSync(resolve(root, OUT), content)
  console.log(`gen-config-catalog: wrote ${OUT}.`)
}
