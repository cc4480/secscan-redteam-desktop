/** CLI entry that writes the generated dsh-scope module or checks it for staleness. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderScopedEvents, repositoryRoot } from './gen-scoped-events-render.ts'

const OUT = 'packages/core/scope/src/scoped-events.generated.ts'

/** Generate or freshness-check the fixed dsh-scope source file. */
export function main(): void {
  const content = renderScopedEvents()
  const output = resolve(repositoryRoot, OUT)
  if (process.argv.includes('--check')) {
    const committed = existsSync(output) ? readFileSync(output, 'utf8') : null
    if (committed === content) {
      console.log(`gen-scoped-events: ${OUT} is up to date.`)
      return
    }
    console.error(`gen-scoped-events: ${OUT} is stale. Run \`pnpm run gen-scoped-events\` and commit it.`)
    process.exit(1)
  }
  writeFileSync(output, content)
  console.log(`gen-scoped-events: wrote ${OUT}.`)
}
