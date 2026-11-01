/**
 * Arsenal read path — the three model-facing tools (spec §7).
 *
 * `arsenal_search`, `arsenal_browse` and `arsenal_recommend` ride the console's
 * existing POST /mcp as a third surface, in the exec-surface shape
 * (`run(args) => Promise<string>`, brief §2): each run returns the §7 envelope
 * as JSON text. Handlers read ONLY the local SQLite index through the serving
 * store — no network I/O, no ingest code, no child processes, ever (spec §3).
 *
 * Contracts honored here:
 *   - Empty index is a typed result, not an exception and not an empty list:
 *     every tool returns the ARSENAL_INDEX_EMPTY block with its fix string.
 *   - User text is data, never FTS syntax (§7.2): terms are NUL-sanitized,
 *     double-quote-escaped, quoted, and ANDed for search. Recommend joins the
 *     same literal terms with OR instead — §7.4 makes facet overlap the
 *     relevance mechanism, so its candidate set is the union of term matches.
 *   - Determinism (§7.5): search orders by (weighted bm25, name, id);
 *     recommend by (facet-overlap count, bm25, name, id). A fixed generation
 *     answers identical inputs byte-identically.
 *   - Bounds (§7.1): limit defaults to 10 and clamps to 50; descriptions are
 *     truncated at 280 chars with the flag set — never silently.
 *
 * The endpoint seam (ARS-1) binds the desktop-correct config via
 * {@link bindArsenalConfig}; unbound, handlers resolve config from the
 * process env per call (the REDTEAM_ARSENAL_DB_PATH fixture path).
 */
import type { DatabaseSync } from 'node:sqlite'
import { resolveArsenalServingConfig, type ArsenalConfig } from './config.js'
import {
  openArsenalServingStore,
  type ArsenalIndexMeta,
  type ArsenalServingStore,
} from './index-store.js'
import { deriveFacets } from './tag-rules.js'

/** Exec-surface tool shape (brief §2): structurally `ExecToolDef`. */
export interface ArsenalToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<string>
}

/** The fix string every empty-index answer carries (spec §7.1). */
export const ARSENAL_EMPTY_FIX = 'Run: redteam-runner arsenal refresh'

const TARGET_IDS = ['SS', 'SL', 'WA', 'WS', 'LX'] as const
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
const MAX_DESCRIPTION_CHARS = 280

/* ------------------------------------------------------------------ */
/* Config + serving-store plumbing                                     */
/* ------------------------------------------------------------------ */

let boundConfig: ArsenalConfig | undefined
let servingStore: ArsenalServingStore | undefined

/**
 * Bind the config the endpoint resolved for this server (ARS-1's seam calls
 * this with `resolveArsenalServingConfig(process.env, { engagementsDir })`,
 * so the DB path follows the console's real engagements dir — brief §1.4).
 * Until bound, handlers resolve from the process env on every call.
 */
export function bindArsenalConfig(config: ArsenalConfig): void {
  boundConfig = config
  servingStore = undefined
}

function currentConfig(): ArsenalConfig {
  return boundConfig ?? resolveArsenalServingConfig(process.env)
}

/** The serving generation's handle + meta, or null when no index exists. */
function serving(): { db: DatabaseSync; meta: ArsenalIndexMeta } | null {
  const config = currentConfig()
  if (servingStore === undefined || servingStore.dbPath !== config.dbPath) {
    servingStore?.close()
    servingStore = openArsenalServingStore(config.dbPath)
  }
  return servingStore.current()
}

function emptyIndexResult(): string {
  return JSON.stringify({
    error: { code: 'ARSENAL_INDEX_EMPTY', fix: ARSENAL_EMPTY_FIX },
  })
}

function indexStamp(meta: ArsenalIndexMeta): Record<string, unknown> {
  return {
    generation: meta.generation,
    built_at: meta.builtAt,
    source_commit: meta.sourceCommit,
  }
}

/* ------------------------------------------------------------------ */
/* Argument validation (the endpoint passes args raw; schemas are the  */
/* contract, these checks are the enforcement)                         */
/* ------------------------------------------------------------------ */

function requiredText(
  args: Record<string, unknown>,
  key: string,
  tool: string,
  maxLength: number,
): string {
  const raw = args[key]
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > maxLength) {
    throw new Error(
      `${tool}: "${key}" must be a string of 1..${maxLength} characters`,
    )
  }
  return raw
}

function optionalText(
  args: Record<string, unknown>,
  key: string,
  tool: string,
): string | undefined {
  const raw = args[key]
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') {
    throw new Error(`${tool}: "${key}" must be a string`)
  }
  return raw.trim() === '' ? undefined : raw
}

function optionalTarget(
  args: Record<string, unknown>,
  tool: string,
): string | undefined {
  const raw = optionalText(args, 'target', tool)
  if (raw === undefined) return undefined
  if (!(TARGET_IDS as readonly string[]).includes(raw)) {
    throw new Error(
      `${tool}: "target" must be one of ${TARGET_IDS.join(', ')}`,
    )
  }
  return raw
}

function optionalLimit(
  args: Record<string, unknown>,
  tool: string,
): number {
  const raw = args['limit']
  if (raw === undefined) return DEFAULT_LIMIT
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${tool}: "limit" must be a number`)
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(raw)))
}

/* ------------------------------------------------------------------ */
/* Query sanitizer (spec §7.2) — user text is data, never MATCH syntax */
/* ------------------------------------------------------------------ */

/**
 * Split caller text into literal FTS terms: NULs are mapped to U+FFFD (the
 * session-provider discipline — a NUL never reaches MATCH), whitespace is
 * normalized, and every term is double-quote-escaped and quoted so FTS
 * operators in the input (`OR`, `NEAR(`, `*`, parentheses) stay inert data.
 */
export function arsenalFtsTerms(raw: string): string[] {
  const normalized = raw
    .replaceAll('\0', '�')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized === '') return []
  return normalized
    .split(' ')
    .map(term => `"${term.replaceAll('"', '""')}"`)
}

/** The search MATCH expression: every term must hit (spec §7.2, AND). */
export function buildArsenalFtsMatch(raw: string): string {
  return arsenalFtsTerms(raw).join(' AND ')
}

/** The recommend MATCH expression: any term may hit (spec §7.4, OR). */
export function buildArsenalFtsMatchAny(raw: string): string {
  return arsenalFtsTerms(raw).join(' OR ')
}

/* ------------------------------------------------------------------ */
/* Row shaping                                                         */
/* ------------------------------------------------------------------ */

interface EntryRow extends Record<string, unknown> {
  id: number
  name: string
  url: string
  description: string
  collection_slug: string
  tags: string
  targets: string
  battery: string
  score: number
}

function parseFacetArray(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

interface ArsenalResultItem {
  name: string
  url: string
  description: string
  description_truncated: boolean
  collection: string
  tags: string[]
  targets: string[]
  battery: string[]
}

function toResultItem(row: EntryRow): ArsenalResultItem {
  const truncated = row.description.length > MAX_DESCRIPTION_CHARS
  return {
    name: row.name,
    url: row.url,
    description: truncated
      ? row.description.slice(0, MAX_DESCRIPTION_CHARS)
      : row.description,
    description_truncated: truncated,
    collection: row.collection_slug,
    tags: parseFacetArray(row.tags),
    targets: parseFacetArray(row.targets),
    battery: parseFacetArray(row.battery),
  }
}

/* ------------------------------------------------------------------ */
/* Facet filter SQL (shared by search + recommend)                     */
/* ------------------------------------------------------------------ */

interface FacetFilters {
  category?: string
  target?: string
  battery?: string
}

/**
 * WHERE fragments + params filtering `entries` (alias `e`, joined to
 * `collections c`) by the stored facets. Category accepts a collection slug,
 * a topic, a `topic:<kebab>` tag, or any stored tag (spec §7.2).
 */
function facetFilterSql(filters: FacetFilters): {
  sql: string
  params: Array<string | number>
} {
  const clauses: string[] = []
  const params: Array<string | number> = []
  if (filters.category !== undefined) {
    clauses.push(
      '(e.collection_slug = ? OR c.topic = ? OR EXISTS (' +
        'SELECT 1 FROM json_each(e.tags) WHERE json_each.value = ? OR json_each.value = ?))',
    )
    params.push(
      filters.category,
      filters.category,
      filters.category,
      `topic:${filters.category}`,
    )
  }
  if (filters.target !== undefined) {
    clauses.push(
      'EXISTS (SELECT 1 FROM json_each(e.targets) WHERE json_each.value = ?)',
    )
    params.push(filters.target)
  }
  if (filters.battery !== undefined) {
    clauses.push(
      'EXISTS (SELECT 1 FROM json_each(e.battery) WHERE json_each.value = ?)',
    )
    params.push(filters.battery)
  }
  return { sql: clauses.join(' AND '), params }
}

const ENTRY_COLUMNS =
  'e.id AS id, e.name AS name, e.url AS url, e.description AS description, ' +
  'e.collection_slug AS collection_slug, e.tags AS tags, e.targets AS targets, e.battery AS battery'

/* ------------------------------------------------------------------ */
/* arsenal_search (spec §7.2, ranking §7.5)                            */
/* ------------------------------------------------------------------ */

async function runSearch(args: Record<string, unknown>): Promise<string> {
  const tool = 'arsenal_search'
  const query = requiredText(args, 'query', tool, 200)
  const filters: FacetFilters = {
    category: optionalText(args, 'category', tool),
    target: optionalTarget(args, tool),
    battery: optionalText(args, 'battery', tool),
  }
  const limit = optionalLimit(args, tool)

  const live = serving()
  if (live === null) return emptyIndexResult()
  const { db, meta } = live

  const facet = facetFilterSql(filters)
  const where = facet.sql === '' ? '' : ` AND ${facet.sql}`
  const match = buildArsenalFtsMatch(query)

  const totalRow = db
    .prepare(
      'SELECT count(*) AS n FROM entries_fts ' +
        'JOIN entries e ON e.id = entries_fts.rowid ' +
        'JOIN collections c ON c.slug = e.collection_slug ' +
        `WHERE entries_fts MATCH ?${where}`,
    )
    .get(match, ...facet.params) as Record<string, unknown>
  const total = Number(totalRow['n'] ?? 0)

  const rows = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS}, bm25(entries_fts, 3.0, 1.0, 1.0, 0.0) AS score FROM entries_fts ` +
        'JOIN entries e ON e.id = entries_fts.rowid ' +
        'JOIN collections c ON c.slug = e.collection_slug ' +
        `WHERE entries_fts MATCH ?${where} ` +
        'ORDER BY score ASC, e.name ASC, e.id ASC LIMIT ?',
    )
    .all(match, ...facet.params, limit) as EntryRow[]

  return JSON.stringify({
    results: rows.map(toResultItem),
    total,
    index: indexStamp(meta),
  })
}

/* ------------------------------------------------------------------ */
/* arsenal_browse (spec §7.3)                                          */
/* ------------------------------------------------------------------ */

interface CollectionRow extends Record<string, unknown> {
  slug: string
  name: string
  url: string
  description: string
  topic: string
  fetched_at: string | null
  entry_count: number
}

function topicTag(topic: string): string {
  return `topic:${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

async function runBrowse(args: Record<string, unknown>): Promise<string> {
  const tool = 'arsenal_browse'
  const category = optionalText(args, 'category', tool)

  const live = serving()
  if (live === null) return emptyIndexResult()
  const { db, meta } = live

  const collections = db
    .prepare(
      'SELECT slug, name, url, description, topic, fetched_at, entry_count ' +
        'FROM collections ORDER BY name ASC, slug ASC',
    )
    .all() as CollectionRow[]

  if (category === undefined) {
    const byTopic = new Map<string, { collections: number; entries: number }>()
    for (const c of collections) {
      const agg = byTopic.get(c.topic) ?? { collections: 0, entries: 0 }
      agg.collections += 1
      agg.entries += c.entry_count
      byTopic.set(c.topic, agg)
    }
    const topics = [...byTopic.entries()]
      .map(([topic, agg]) => ({
        topic,
        collections: agg.collections,
        entries: agg.entries,
      }))
      .sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0))
    return JSON.stringify({ topics, index: indexStamp(meta) })
  }

  const matched = collections.filter(
    c =>
      c.topic === category ||
      c.slug === category ||
      topicTag(c.topic) === category,
  )
  return JSON.stringify({
    collections: matched.map(c => ({
      slug: c.slug,
      name: c.name,
      url: c.url,
      description: c.description,
      entry_count: c.entry_count,
      level2: c.fetched_at !== null,
    })),
    index: indexStamp(meta),
  })
}

/* ------------------------------------------------------------------ */
/* arsenal_recommend (spec §7.4)                                       */
/* ------------------------------------------------------------------ */

async function runRecommend(args: Record<string, unknown>): Promise<string> {
  const tool = 'arsenal_recommend'
  const task = requiredText(args, 'task', tool, 500)
  const target = optionalTarget(args, tool)
  const limit = optionalLimit(args, tool)

  const live = serving()
  if (live === null) return emptyIndexResult()
  const { db, meta } = live

  const derived = deriveFacets(task)
  const facetSets: Array<{
    column: 'targets' | 'battery' | 'tags'
    values: string[]
  }> = [
    { column: 'targets', values: derived.targets },
    { column: 'battery', values: derived.battery },
    { column: 'tags', values: derived.tags },
  ]

  // Facet-overlap count, computed in SQL so ordering (and the pre-limit
  // total) is exact: one point per stored facet the task's rules derived.
  const overlapTerms: string[] = []
  const overlapParams: Array<string | number> = []
  for (const set of facetSets) {
    if (set.values.length === 0) continue
    const placeholders = set.values.map(() => '?').join(', ')
    overlapTerms.push(
      `(SELECT count(*) FROM json_each(e.${set.column}) WHERE json_each.value IN (${placeholders}))`,
    )
    overlapParams.push(...set.values)
  }
  const overlapSql =
    overlapTerms.length === 0 ? '0' : overlapTerms.join(' + ')

  const facet = facetFilterSql(target === undefined ? {} : { target })
  const where = facet.sql === '' ? '' : ` AND ${facet.sql}`
  const match = buildArsenalFtsMatchAny(task)
  if (match === '') {
    // A task of only whitespace/NULs was already rejected by requiredText;
    // a task whose terms all sanitize away cannot match — answer, don't throw.
    return JSON.stringify({ results: [], total: 0, index: indexStamp(meta) })
  }

  const totalRow = db
    .prepare(
      'SELECT count(*) AS n FROM entries_fts ' +
        'JOIN entries e ON e.id = entries_fts.rowid ' +
        'JOIN collections c ON c.slug = e.collection_slug ' +
        `WHERE entries_fts MATCH ?${where}`,
    )
    .get(match, ...facet.params) as Record<string, unknown>
  const total = Number(totalRow['n'] ?? 0)

  const rows = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS}, bm25(entries_fts, 3.0, 1.0, 1.0, 0.0) AS score, ` +
        `(${overlapSql}) AS overlap FROM entries_fts ` +
        'JOIN entries e ON e.id = entries_fts.rowid ' +
        'JOIN collections c ON c.slug = e.collection_slug ' +
        `WHERE entries_fts MATCH ?${where} ` +
        'ORDER BY overlap DESC, score ASC, e.name ASC, e.id ASC LIMIT ?',
    )
    // Placeholder order follows the SQL text: the overlap expression sits
    // in the SELECT list, before the WHERE clause's MATCH and facet params.
    .all(...overlapParams, match, ...facet.params, limit) as Array<
    EntryRow & { overlap: number }
  >

  const derivedSets = {
    targets: new Set(derived.targets),
    battery: new Set(derived.battery),
    tags: new Set(derived.tags),
  }
  const results = rows.map((row) => {
    const item = toResultItem(row)
    const why: string[] = []
    for (const t of item.targets) {
      if (derivedSets.targets.has(t)) why.push(`target:${t}`)
    }
    for (const b of item.battery) {
      if (derivedSets.battery.has(b)) why.push(`battery:${b}`)
    }
    for (const t of item.tags) {
      if (derivedSets.tags.has(t)) why.push(`tag:${t}`)
    }
    why.sort()
    return { ...item, why }
  })

  return JSON.stringify({
    results,
    total,
    index: indexStamp(meta),
  })
}

/* ------------------------------------------------------------------ */
/* The surface                                                         */
/* ------------------------------------------------------------------ */

export const ARSENAL_TOOLS: ArsenalToolDef[] = [
  {
    name: 'arsenal_search',
    description:
      'Search the Arsenal knowledge index (curated security collections: ' +
      'wordlists, payload sets, technique references) by free text, with ' +
      'optional facet filters. The query is literal data — FTS operators ' +
      'never execute. Returns up to `limit` entries (default 10, max 50) ' +
      'ranked by weighted relevance, plus the total match count and the ' +
      'index generation stamp. Read-only and offline: results come only ' +
      'from the operator-built local index.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        category: {
          type: 'string',
          description: 'Topic tag or collection slug filter',
        },
        target: { type: 'string', enum: [...TARGET_IDS] },
        battery: {
          type: 'string',
          description:
            'Category (logic|functionality|validation) or item id (e.g. F-9)',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
    run: runSearch,
  },
  {
    name: 'arsenal_browse',
    description:
      'Discover the Arsenal index structure. Without a category, returns ' +
      'the topic census (collections and entry counts per topic). With a ' +
      "category (a topic), returns that topic's collections with their " +
      'entry counts; `level2: false` marks collections indexed at Level 1 ' +
      'only (name/url/description — no entries ingested yet).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        category: {
          type: 'string',
          description: 'Topic; omit for the topic census',
        },
      },
    },
    run: runBrowse,
  },
  {
    name: 'arsenal_recommend',
    description:
      'Task-shaped retrieval from the Arsenal index: give the current task ' +
      'text and get the entries most relevant to it, pre-sorted by facet ' +
      "fit (deterministic keyword rules derive the task's targets, battery " +
      'items and tags; results rank by facet overlap, then relevance). ' +
      'Each result carries `why` — the facets that matched — so a ' +
      'recommendation can be discounted when the inference is wrong. ' +
      '`target`, when given, is a hard filter.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['task'],
      properties: {
        task: { type: 'string', minLength: 1, maxLength: 500 },
        target: { type: 'string', enum: [...TARGET_IDS] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
    run: runRecommend,
  },
]

export const ARSENAL_TOOLS_BY_NAME: Map<string, ArsenalToolDef> = new Map(
  ARSENAL_TOOLS.map(t => [t.name, t]),
)
