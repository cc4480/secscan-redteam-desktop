/** The verify-type-equiv run: manifest/block correspondence, drift detection, exit status. */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { partitionPairedMarkdownDerivatives } from './paired-markdown-derivatives.ts'
import { isArchivedAgentNotePath } from './repo-files.ts'
import { extractEquivBlocks } from './verify-type-equiv-blocks.ts'
import { sourceDeclaration } from './verify-type-equiv-declarations.ts'
import { mergedInterfaceDeclaration } from './verify-type-equiv-merged.ts'
import { repoRoot, type EquivBlock, type ManifestEntry } from './verify-type-equiv-model.ts'
import { normalizeJSDoc, normalizeStructure, stripExport } from './verify-type-equiv-normalize.ts'
import { sourcePublicApi } from './verify-type-equiv-public-api.ts'

/** Scan doc-typecheck's full Markdown scope so unmanifested blocks also fail. */
const MARKDOWN_GLOBS = ['README.md', '.agents/notes/**/*.md', 'docs/**/*.md', 'packages/*/*.md', 'packages/*/*/*.md']

// Key a block/entry by doc + symbol + projection. A symbol may be documented in
// more than one doc, and a doc may carry both complete and projected forms.
const keyOf = (x: { doc: string; symbol: string; projection?: 'public-api' }): string =>
  `${x.doc}::${x.symbol}::${x.projection ?? 'declaration'}`

/** Compare every manifest entry with its documented block and set the process exit status. */
export function runTypeEquivVerification(): void {
  const manifestRaw = readFileSync(resolve(repoRoot, 'scripts/type-equiv.manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestRaw) as { entries: ManifestEntry[] }
  const entries = manifest.entries

  // Collect every type-equiv block across ALL docs in scope — not only the docs
  // the manifest names — so a block in an unmanifested doc is found and reported
  // as an orphan rather than silently skipped.
  const docSet = new Set<string>()
  for (const pattern of MARKDOWN_GLOBS) {
    for (const match of globSync(pattern, { cwd: repoRoot })) {
      const normalized = match.split(sep).join('/')
      if (!isArchivedAgentNotePath(normalized)) docSet.add(normalized)
    }
  }
  const extractedBlocks: EquivBlock[] = [...docSet].sort().flatMap(extractEquivBlocks)
  const { primary: blocks, derivatives } = partitionPairedMarkdownDerivatives(
    extractedBlocks,
    block => block.doc,
    block => `${block.projection ?? 'declaration'}\0${block.code}`,
  )

  const errors: string[] = []
  // A manifest entry naming a doc that does not exist (or is outside the scanned
  // scope, so no block could ever match it) is an error in its own right.
  for (const d of [...new Set(entries.map(e => e.doc))]) {
    if (!existsSync(resolve(repoRoot, d))) errors.push(`manifest references ${d}, which does not exist`)
    else if (!docSet.has(d)) errors.push(`manifest references ${d}, which is outside the scanned markdown scope (${MARKDOWN_GLOBS.join(', ')})`)
  }

  // Duplicate-block guard: the same projected symbol twice in one doc is ambiguous.
  const blockByKey = new Map<string, EquivBlock>()
  for (const b of blocks) {
    const k = keyOf(b)
    const prior = blockByKey.get(k)
    if (prior) {
      errors.push(`duplicate type-equiv block for ${b.symbol} in ${b.doc} (lines ${prior.line} and ${b.line})`)
      continue
    }
    blockByKey.set(k, b)
  }

  // Duplicate-entry guard in the manifest.
  const entryByKey = new Map<string, ManifestEntry>()
  for (const e of entries) {
    const k = keyOf(e)
    if (entryByKey.has(k)) {
      errors.push(`duplicate manifest entry for ${e.symbol} in ${e.doc}`)
      continue
    }
    entryByKey.set(k, e)
  }

  // 1:1 correspondence: orphan blocks (no entry) and orphan entries (no block).
  for (const b of blocks) {
    if (!entryByKey.has(keyOf(b))) {
      errors.push(`type-equiv block ${b.symbol} (${b.doc}:${b.line}) has no manifest entry — add one to scripts/type-equiv.manifest.json`)
    }
  }
  for (const e of entries) {
    if (!blockByKey.has(keyOf(e))) {
      errors.push(`manifest entry ${e.symbol} (${e.doc}) has no matching type-equiv block — remove it or add the block`)
    }
  }

  // Verbatim check: each matched block must equal its source declaration.
  let verified = 0
  for (const e of entries) {
    const b = blockByKey.get(keyOf(e))
    if (!b) continue // already reported as an orphan entry
    const decl = e.augmentations !== undefined
      ? mergedInterfaceDeclaration(e)
      : e.projection === 'public-api'
        ? sourcePublicApi(e.source, e.symbol)
        : sourceDeclaration(e.source, e.symbol)
    if (decl === null) {
      errors.push(`symbol ${e.symbol} not found in ${e.source} (manifest entry for ${e.doc})`)
      continue
    }
    const doc = stripExport(b.code)
    const sourceStructure = normalizeStructure(decl)
    const docStructure = normalizeStructure(doc)
    const sourceJSDoc = normalizeJSDoc(decl)
    const docJSDoc = normalizeJSDoc(doc)
    if (sourceStructure !== docStructure || JSON.stringify(sourceJSDoc) !== JSON.stringify(docJSDoc)) {
      errors.push(
        `DRIFT: ${e.doc}:${b.line} — type-equiv block for ${e.symbol} does not match ${e.source}.\n`
        + `    source structure: ${sourceStructure}\n`
        + `    doc structure:    ${docStructure}\n`
        + `    source JSDoc:     ${JSON.stringify(sourceJSDoc)}\n`
        + `    doc JSDoc:        ${JSON.stringify(docJSDoc)}`,
      )
      continue
    }
    verified++
  }

  if (errors.length === 0) {
    console.log(`verify-type-equiv: ${verified} type-equiv block(s) match source structure and JSDoc (1:1 with manifest); ${derivatives.length} paired derivative(s).`)
    process.exit(0)
  }

  console.error('verify-type-equiv: type-equiv verification failed:')
  for (const e of errors) console.error(`  ${e}`)
  console.error(`\n(checked ${blocks.length} primary block(s) across ${new Set(blocks.map(b => b.doc)).size} doc(s), ${derivatives.length} paired derivative(s); manifest at scripts/type-equiv.manifest.json)`)
  process.exit(1)
}
