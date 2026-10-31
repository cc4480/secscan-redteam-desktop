#!/usr/bin/env node
/**
 * Battery coverage matrix.
 *
 * Reads the redteam battery sources under `src/targets`, groups items by target
 * family and category, counts the ATT&CK techniques touched, and reports the
 * families the battery does not cover yet against a declared domain matrix.
 *
 * Static analysis only: no build, no dependencies. Shows the same numbers the
 * product should show a buyer - covered families, per-category volume, gaps.
 *
 * Usage:
 *   node scripts/coverage-matrix.mjs            # markdown to stdout
 *   node scripts/coverage-matrix.mjs --json     # machine-readable
 *   node scripts/coverage-matrix.mjs --write    # write coverage-matrix.md
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const runnerRoot = resolve(here, '..')
const targetsDir = join(runnerRoot, 'src', 'targets')
const outputPath = join(runnerRoot, 'coverage-matrix.md')

/** Families the battery ships (or should ship); `status` drives the gap report. */
const FAMILIES = {
  SS: { name: 'SecScan service', status: 'covered' },
  SL: { name: 'Seclayer service', status: 'covered' },
  WA: { name: 'Web application', status: 'covered' },
  WS: { name: 'Windows host / AD', status: 'covered' },
  LX: { name: 'Linux host', status: 'covered' },
  CL: { name: 'Cloud (AWS/Azure/GCP)', status: 'gap' },
  API: { name: 'API / auth protocols', status: 'gap' },
  AI: { name: 'AI / LLM red team', status: 'gap' },
  SC: { name: 'CI-CD / supply chain', status: 'gap' },
  NET: { name: 'Network services / databases', status: 'gap' },
  MOB: { name: 'Mobile (iOS/Android)', status: 'out-of-scope' },
  ICS: { name: 'OT / ICS / SCADA', status: 'out-of-scope' },
}

/** Load every battery source file. */
function loadSources() {
  return readdirSync(targetsDir)
    .filter(name => name.endsWith('.ts'))
    .map(name => readFileSync(join(targetsDir, name), { encoding: 'utf8' }))
    .join('\n')
}

/** Extract item ids and the fields the matrix needs, without parsing TypeScript. */
function parseItems(source) {
  const positions = []
  const pattern = /id:\s*"([A-Z]{2}-\d{3})"/gu
  for (const match of source.matchAll(pattern)) positions.push({ id: match[1], start: match.index })
  const items = []
  for (let index = 0; index < positions.length; index += 1) {
    const start = positions[index].start
    const end = index + 1 < positions.length ? positions[index + 1].start : Math.min(source.length, start + 1200)
    const body = source.slice(start, end)
    items.push({
      id: positions[index].id,
      category: /category:\s*"([a-z-]+)"/u.exec(body)?.[1],
      attackId: /attackId:\s*"([A-Z0-9.]+)"/u.exec(body)?.[1],
    })
  }
  return items
}

const items = parseItems(loadSources())
const byFamily = new Map()
for (const item of items) {
  const family = item.id.slice(0, 2)
  const bucket = byFamily.get(family) ?? { total: 0, categories: {}, attackIds: new Set() }
  bucket.total += 1
  const category = item.category ?? 'unset'
  bucket.categories[category] = (bucket.categories[category] ?? 0) + 1
  if (item.attackId !== undefined) bucket.attackIds.add(item.attackId)
  byFamily.set(family, bucket)
}

const rows = Object.entries(FAMILIES).map(([family, meta]) => {
  const bucket = byFamily.get(family)
  return {
    family,
    name: meta.name,
    status: bucket === undefined ? meta.status : 'covered',
    total: bucket?.total ?? 0,
    logic: bucket?.categories.logic ?? 0,
    functionality: bucket?.categories.functionality ?? 0,
    validation: bucket?.categories.validation ?? 0,
    attackTechniques: bucket?.attackIds.size ?? 0,
  }
})

const covered = rows.filter(row => row.status === 'covered')
const gaps = rows.filter(row => row.status === 'gap')
const outOfScope = rows.filter(row => row.status === 'out-of-scope')
const totalItems = covered.reduce((sum, row) => sum + row.total, 0)
const techniques = new Set([...byFamily.values()].flatMap(bucket => [...bucket.attackIds]))

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    totalItems,
    familiesCovered: covered.length,
    familiesGap: gaps.map(row => row.family),
    attackTechniques: techniques.size,
    rows,
  }, null, 2))
  process.exit(0)
}

const lines = [
  '# Battery coverage matrix',
  '',
  `Total items: **${totalItems}** across **${covered.length}** families; ATT&CK techniques touched: **${techniques.size}**.`,
  '',
  '| Family | Name | Status | Items | logic | functionality | validation | ATT&CK |',
  '|---|---|---|---:|---:|---:|---:|---:|',
  ...rows.map(row => `| ${row.family} | ${row.name} | ${row.status} | ${row.total} | ${row.logic} | ${row.functionality} | ${row.validation} | ${row.attackTechniques} |`),
  '',
  `**Gaps (no items yet):** ${gaps.map(row => `${row.family} (${row.name})`).join(', ') || 'none'}`,
  '',
  `**Out of scope:** ${outOfScope.map(row => `${row.family} (${row.name})`).join(', ') || 'none'}`,
  '',
  '## How to close a gap',
  '',
  'Add a target source under `src/targets/<family>-part-N.ts` with the same item shape, register it in',
  '`src/targets.ts`, and re-run this script. Every item needs an `id` (`<FAMILY>-NNN`), a `category`',
  '(`logic` | `functionality` | `validation`), and an `attackId` - the matrix derives from those fields.',
]
const markdown = `${lines.join('\n')}\n`

if (process.argv.includes('--write')) {
  writeFileSync(outputPath, markdown, { encoding: 'utf8' })
  console.log(`wrote ${outputPath}`)
} else {
  console.log(markdown)
}
