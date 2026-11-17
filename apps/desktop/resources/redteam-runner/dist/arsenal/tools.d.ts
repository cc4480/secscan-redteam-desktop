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
export { ARSENAL_EMPTY_FIX, bindArsenalConfig } from './tools-store.js';
export { arsenalFtsTerms, buildArsenalFtsMatch, buildArsenalFtsMatchAny } from './tools-query.js';
/** Exec-surface tool shape (brief §2): structurally `ExecToolDef`. */
export interface ArsenalToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    run: (args: Record<string, unknown>) => Promise<string>;
}
export declare const ARSENAL_TOOLS: ArsenalToolDef[];
export declare const ARSENAL_TOOLS_BY_NAME: Map<string, ArsenalToolDef>;
