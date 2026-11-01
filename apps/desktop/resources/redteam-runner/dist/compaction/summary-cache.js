/**
 * Summary cache (PentAGI csum pattern, A3 Deep — Carlos, 2026-10-27).
 *
 * Summaries are keyed by the SHA-256 of the exact transcript slice they
 * summarize: identical evidence is never re-summarized, and a cache hit
 * is proof the slice is byte-identical to one already summarized. The
 * cache is an LRU with a hard entry cap (PentAGI uses 100); eviction is
 * silent and safe — a miss simply re-summarizes.
 */
import { createHash } from "node:crypto";
/** SHA-256 hex digest of a transcript slice — the summary cache key. */
export function summaryKey(sliceText) {
    return createHash("sha256").update(sliceText).digest("hex");
}
export class SummaryCache {
    maxEntries;
    entries = new Map();
    hits = 0;
    misses = 0;
    constructor(maxEntries = 100) {
        this.maxEntries = maxEntries;
    }
    get size() {
        return this.entries.size;
    }
    /** Look up a summary; a hit refreshes the entry's LRU position. */
    get(key) {
        const value = this.entries.get(key);
        if (value === undefined) {
            this.misses++;
            return null;
        }
        this.hits++;
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }
    /** Store a summary, evicting least-recently-used entries past the cap. */
    set(key, value) {
        this.entries.delete(key);
        this.entries.set(key, value);
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            this.entries.delete(oldest);
        }
    }
}
const perEngagement = new WeakMap();
/** The summary cache belonging to one engagement context (created lazily). */
export function summaryCacheFor(ctx) {
    let cache = perEngagement.get(ctx);
    if (!cache) {
        cache = new SummaryCache();
        perEngagement.set(ctx, cache);
    }
    return cache;
}
//# sourceMappingURL=summary-cache.js.map