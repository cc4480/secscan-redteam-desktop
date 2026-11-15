/**
 * The generator's command: resolve the catalog from the workspace root, then
 * either write the committed artifact or, with `--check`, fail when it is stale.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { renderClientCatalog } from './gen-client-catalog-render.ts'
import { collectSlotEntries } from './gen-client-catalog-scan.ts'

const root = resolve(import.meta.dirname, '..')
const OUT = 'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts'

/**
 * CLI entry: regenerate the catalog, or with `--check` fail when it is stale.
 * @returns nothing; writes the artifact or reports freshness through the process.
 */
export function main(): void {
  const content = renderClientCatalog(collectSlotEntries(root))
  const destination = resolve(root, OUT)
  if (process.argv.includes('--check')) {
    let committed: string | null = null
    try {
      committed = readFileSync(destination, 'utf8')
    } catch {
      // Only ENOENT (never generated) is expected here, and its remedy is the
      // same as a stale artifact's: regenerate.
      committed = null
    }
    if (committed === content) {
      console.log(`gen-client-catalog: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-client-catalog: stale — ${OUT}. Run \`pnpm run gen-client-catalog\` and commit the result.`)
    process.exit(1)
  }
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, content)
  console.log(`gen-client-catalog: wrote ${OUT}.`)
}
