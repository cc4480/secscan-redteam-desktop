/**
 * Registry types — extracted from store.ts to keep the store module under the
 * 300-line budget. Pure declarations plus the empty-registry constructor.
 */
export function emptyRegistry() {
    return { version: 1, confirmed: [], killed: [] };
}
//# sourceMappingURL=types.js.map