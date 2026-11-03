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

import { runBrowse, runRecommend, runSearch } from './tools-handlers.js'
import { TARGET_IDS } from './tools-store.js'

export { ARSENAL_EMPTY_FIX, bindArsenalConfig } from './tools-store.js'
export { arsenalFtsTerms, buildArsenalFtsMatch, buildArsenalFtsMatchAny } from './tools-query.js'

/** Exec-surface tool shape (brief §2): structurally `ExecToolDef`. */
export interface ArsenalToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<string>
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
