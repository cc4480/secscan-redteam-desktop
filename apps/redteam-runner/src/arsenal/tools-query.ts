/**
 * Argument validation, the FTS sanitizer, row shaping, and the shared facet
 * filter SQL — extracted from `tools.ts` so every module stays inside the
 * runner's 300-line file budget. Pure helpers: no I/O of their own.
 */
import { DEFAULT_LIMIT, MAX_LIMIT, TARGET_IDS } from './tools-store.js'

const MAX_DESCRIPTION_CHARS = 280

/* ------------------------------------------------------------------ */
/* Argument validation (the endpoint passes args raw; schemas are the  */
/* contract, these checks are the enforcement)                         */
/* ------------------------------------------------------------------ */

export function requiredText(
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

export function optionalText(
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

export function optionalTarget(
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

export function optionalLimit(
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

export interface EntryRow extends Record<string, unknown> {
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

export interface ArsenalResultItem {
  name: string
  url: string
  description: string
  description_truncated: boolean
  collection: string
  tags: string[]
  targets: string[]
  battery: string[]
}

export function toResultItem(row: EntryRow): ArsenalResultItem {
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

export interface FacetFilters {
  category?: string
  target?: string
  battery?: string
}

/**
 * WHERE fragments + params filtering `entries` (alias `e`, joined to
 * `collections c`) by the stored facets. Category accepts a collection slug,
 * a topic, a `topic:<kebab>` tag, or any stored tag (spec §7.2).
 */
export function facetFilterSql(filters: FacetFilters): {
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

export const ENTRY_COLUMNS =
  'e.id AS id, e.name AS name, e.url AS url, e.description AS description, ' +
  'e.collection_slug AS collection_slug, e.tags AS tags, e.targets AS targets, e.battery AS battery'
