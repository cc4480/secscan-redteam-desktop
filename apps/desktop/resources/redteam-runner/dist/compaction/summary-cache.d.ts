/** SHA-256 hex digest of a transcript slice — the summary cache key. */
export declare function summaryKey(sliceText: string): string;
export declare class SummaryCache {
    private readonly maxEntries;
    private readonly entries;
    hits: number;
    misses: number;
    constructor(maxEntries?: number);
    get size(): number;
    /** Look up a summary; a hit refreshes the entry's LRU position. */
    get(key: string): string | null;
    /** Store a summary, evicting least-recently-used entries past the cap. */
    set(key: string, value: string): void;
}
/** The summary cache belonging to one engagement context (created lazily). */
export declare function summaryCacheFor(ctx: object): SummaryCache;
