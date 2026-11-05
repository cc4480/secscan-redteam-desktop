export declare function requiredText(args: Record<string, unknown>, key: string, tool: string, maxLength: number): string;
export declare function optionalText(args: Record<string, unknown>, key: string, tool: string): string | undefined;
export declare function optionalTarget(args: Record<string, unknown>, tool: string): string | undefined;
export declare function optionalLimit(args: Record<string, unknown>, tool: string): number;
/**
 * Split caller text into literal FTS terms: NULs are mapped to U+FFFD (the
 * session-provider discipline — a NUL never reaches MATCH), whitespace is
 * normalized, and every term is double-quote-escaped and quoted so FTS
 * operators in the input (`OR`, `NEAR(`, `*`, parentheses) stay inert data.
 */
export declare function arsenalFtsTerms(raw: string): string[];
/** The search MATCH expression: every term must hit (spec §7.2, AND). */
export declare function buildArsenalFtsMatch(raw: string): string;
/** The recommend MATCH expression: any term may hit (spec §7.4, OR). */
export declare function buildArsenalFtsMatchAny(raw: string): string;
export interface EntryRow extends Record<string, unknown> {
    id: number;
    name: string;
    url: string;
    description: string;
    collection_slug: string;
    tags: string;
    targets: string;
    battery: string;
    score: number;
}
export interface ArsenalResultItem {
    name: string;
    url: string;
    description: string;
    description_truncated: boolean;
    collection: string;
    tags: string[];
    targets: string[];
    battery: string[];
}
export declare function toResultItem(row: EntryRow): ArsenalResultItem;
export interface FacetFilters {
    category?: string;
    target?: string;
    battery?: string;
}
/**
 * WHERE fragments + params filtering `entries` (alias `e`, joined to
 * `collections c`) by the stored facets. Category accepts a collection slug,
 * a topic, a `topic:<kebab>` tag, or any stored tag (spec §7.2).
 */
export declare function facetFilterSql(filters: FacetFilters): {
    sql: string;
    params: Array<string | number>;
};
export declare const ENTRY_COLUMNS: string;
