/**
 * Write every graph document, or verify the committed set against a fresh
 * render when `--check` is passed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { renderDocs } from './gen-doc-graphs-docs.ts'
import { root } from './gen-doc-graphs-shared.ts'

/** Write the rendered graph documents, or verify the committed ones with `--check`. */
export function main(): void {
  const docs = renderDocs()
  if (process.argv.includes('--check')) {
    const stale: string[] = []
    for (const doc of docs) {
      const abs = resolve(root, doc.rel)
      const committed = existsSync(abs) ? readFileSync(abs, 'utf8') : null
      if (committed !== doc.content) stale.push(doc.rel)
    }
    if (stale.length === 0) {
      console.log(`gen-doc-graphs: ${docs.length} graph doc(s) are up to date.`)
      return
    }
    console.error(`gen-doc-graphs: stale graph doc(s): ${stale.join(', ')}. Run \`pnpm run gen-doc-graphs\` and commit the result.`)
    process.exit(1)
  }

  for (const doc of docs) {
    mkdirSync(dirname(resolve(root, doc.rel)), { recursive: true })
    writeFileSync(resolve(root, doc.rel), doc.content)
  }
  console.log(`gen-doc-graphs: wrote ${docs.length} graph doc(s).`)
}
