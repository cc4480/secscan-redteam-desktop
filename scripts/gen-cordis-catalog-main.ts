import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { renderCordisCoreApiPages } from './cordis-core-api.ts'
import { computeOutputs } from './gen-cordis-catalog-compute.ts'
import { EVENT_SCOPE_PAGE, SERVICE_PAGE } from './gen-cordis-catalog-pages.ts'
import { root, SUBSYSTEMS_DIR } from './gen-cordis-catalog-root.ts'
import {
  blobHash,
  parsePairMeta,
  partitionGeneratedRegions,
  renderPairMeta,
} from './translation-pairing.ts'

/**
 * Re-record a pair's `.i18n.yaml` after a region write ONLY when the write is
 * region-confined: both sides' region-stripped content must be byte-equal to
 * the region-stripped previous content whose hashes the record holds. The
 * caller supplies the previous bytes (read before writing); human-content
 * drift leaves the record untouched so the pairing gate still demands the
 * normal translation flow.
 * @param pageRel - repo-relative English page path (`docs/subsystems/x.md`).
 * @param before - pre-write bytes per repo-relative path.
 * @param scanRoot - repository root override for tests.
 * @returns true when the record was refreshed.
 */
export function maybeRecordPair(pageRel: string, before: Map<string, Buffer>, scanRoot: string = root): boolean {
  const zhRel = pageRel.replace(/\.md$/, '.zh.md')
  const metaRel = pageRel.replace(/\.md$/, '.i18n.yaml')
  const metaAbs = resolve(scanRoot, metaRel)
  let meta: string
  try {
    meta = readFileSync(metaAbs, 'utf8')
  } catch {
    // No record yet: a brand-new pair is recorded by the author's --write
    // after review, never silently by regeneration.
    return false
  }
  // The record must contain exactly the two valid entries for THIS pair;
  // a malformed or renamed-key sidecar is the pairing gate's problem to
  // report, never something regeneration silently repairs into validity.
  const recorded = parsePairMeta(meta)
  const names = [pageRel, zhRel].map(rel => rel.split('/').at(-1) ?? rel)
  if (!recorded || recorded.size !== 2 || !names.every(name => recorded.has(name))) return false
  for (const rel of [pageRel, zhRel]) {
    const previous = before.get(rel)
    if (!previous) return false
    if (recorded.get(rel.split('/').at(-1) ?? rel) !== blobHash(previous)) return false
    const current = readFileSync(resolve(scanRoot, rel))
    const strippedBefore = partitionGeneratedRegions(previous.toString('utf8')).stripped
    const strippedAfter = partitionGeneratedRegions(current.toString('utf8')).stripped
    if (strippedBefore !== strippedAfter) return false
  }
  const source = readFileSync(resolve(scanRoot, pageRel))
  const zh = readFileSync(resolve(scanRoot, zhRel))
  writeFileSync(metaAbs, renderPairMeta(pageRel, blobHash(source), zhRel, blobHash(zh)))
  return true
}

/** CLI entry: default regenerates every artifact, `--check` fails if any is
 * stale. Guarded behind an entry-point check so importing this module for
 * tests neither regenerates the committed files nor calls process.exit.
 * @returns nothing; writes files or reports freshness through the process.
 */
export function main(): void {
  const outputs: [string, string][] = [
    ...computeOutputs(),
    ...renderCordisCoreApiPages(),
  ]
  if (process.argv.includes('--check')) {
    const stale: string[] = []
    for (const [out, content] of outputs) {
      let committed: string | null = null
      try {
        committed = readFileSync(resolve(root, out), 'utf8')
      } catch {
        // Only ENOENT (not yet generated) is expected; a present-but-unreadable
        // file is not a state this repo produces. Either way the remedy is the
        // same — regenerate — so treat a read failure as "stale".
        committed = null
      }
      if (committed !== content) stale.push(out)
    }
    if (stale.length === 0) {
      console.log(`gen-cordis-catalog: ${outputs.length} generated file(s)/region(s) are up to date.`)
      process.exit(0)
    }
    console.error(`gen-cordis-catalog: stale — ${stale.join(', ')}. Run \`pnpm run gen-cordis-catalog\` and commit the result.`)
    process.exit(1)
  }

  const before = new Map<string, Buffer>()
  for (const [out] of outputs) {
    try {
      before.set(out, readFileSync(resolve(root, out)))
    } catch {
      // First generation of this artifact; nothing to guard, nothing to record.
    }
  }
  let changedPages = 0
  let recorded = 0
  for (const [out, content] of outputs) {
    const destination = resolve(root, out)
    if (before.get(out)?.toString('utf8') === content) continue
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, content)
    changedPages++
  }
  for (const page of [...new Set([...Object.values(SERVICE_PAGE), ...Object.values(EVENT_SCOPE_PAGE)])]) {
    const rel = `${SUBSYSTEMS_DIR}/${page}`
    const zhRel = rel.replace(/\.md$/, '.zh.md')
    const wroteEither = [rel, zhRel].some((side) => {
      const previous = before.get(side)
      return previous !== undefined && previous.toString('utf8') !== readFileSync(resolve(root, side), 'utf8')
    })
    if (wroteEither && maybeRecordPair(rel, before)) recorded++
  }
  console.log(`gen-cordis-catalog: ${outputs.length} artifact(s) computed, ${changedPages} written, ${recorded} pair record(s) refreshed.`)
}
