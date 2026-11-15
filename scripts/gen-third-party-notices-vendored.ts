/**
 * Parses the vendored-package manifest table out of `vendor/README.md` and
 * reconciles it against the vendored directory tree.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { root } from './gen-third-party-notices-shared.ts'
import { readManifest } from './gen-third-party-notices-manifests.ts'

/** A vendored package row parsed out of the `vendor/README.md` manifest table. */
export interface VendoredRow {
  npmName: string
  /** The name this package carries upstream; MIT attribution names the fork's origin, not our scope. */
  upstreamName: string
  upstream: string
}

/**
 * Parse the vendored-package manifest table out of `vendor/README.md`.
 * @param text - the complete `vendor/README.md` contents.
 * @returns one row per manifest-table entry, in table order.
 */
export function parseVendoredRows(text: string): VendoredRow[] {
  const rows: VendoredRow[] = []
  for (const line of text.split('\n')) {
    const match = new RegExp(String.raw`^\| \x60\S+\/\x60 \| \x60([^\x60]+)\x60 \| \x60([^\x60]+)\x60 \| \S+ \| `
      + String.raw`(https:\/\/\S+?)(?: \([^)]*\))? \| \x60[0-9a-f]+\x60 \|$`).exec(line)
    if (match === null) continue
    const [, npmName, upstreamName, upstream] = match
    if (npmName === undefined || upstreamName === undefined || upstream === undefined) continue
    rows.push({ npmName, upstreamName, upstream })
  }
  return rows
}

/**
 * Parse the vendored manifest table and confirm it accounts for every vendored
 * directory. The `vendor/` tree — not the table — is the set that must be
 * disclosed, so a row that stops matching the table format is a hard error
 * rather than a package that quietly vanishes from the notices.
 * @returns every vendored row together with the directory it is published from.
 */
export function collectVendored(): (VendoredRow & { sourceDirectory: string })[] {
  const rows = parseVendoredRows(readFileSync(resolve(root, 'vendor/README.md'), 'utf8'))
  const onDisk = new Map<string, string>()
  for (const entry of readdirSync(resolve(root, 'vendor'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = readManifest(`vendor/${entry.name}/package.json`)
    if (manifest.name !== undefined) onDisk.set(manifest.name, entry.name)
  }

  const parsed = new Set(rows.map(row => row.npmName))
  const missing = [...onDisk.keys()].filter(name => !parsed.has(name))
  if (missing.length > 0) {
    throw new Error(`gen-third-party-notices: vendor/README.md has no manifest-table row for ${missing.join(', ')}; its table format changed or the sync is incomplete.`)
  }
  return rows.map((row) => {
    const dir = onDisk.get(row.npmName)
    if (dir === undefined) throw new Error(`gen-third-party-notices: vendored package ${row.npmName} from vendor/README.md has no vendor/ directory.`)
    const license = readManifest(`vendor/${dir}/package.json`).license
    if (license !== 'MIT') {
      throw new Error(`gen-third-party-notices: vendored ${row.npmName} declares license ${JSON.stringify(license)}; the vendored section assumes MIT throughout.`)
    }
    return { ...row, sourceDirectory: `vendor/${dir}` }
  })
}
