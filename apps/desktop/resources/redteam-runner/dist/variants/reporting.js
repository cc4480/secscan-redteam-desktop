export function countVariants(ledger) {
    let variantExecutions = 0;
    let variantConfirmed = 0;
    let itemsWithVariants = 0;
    let itemsCapped = 0;
    for (const v of ledger.values()) {
        const vp = v.variants;
        if (!vp)
            continue;
        itemsWithVariants++;
        variantExecutions += vp.executed;
        variantConfirmed += vp.confirmed;
        // The cap cut the library short: executed hit the cap below library size.
        if (vp.executed >= vp.cap && vp.cap < vp.librarySize)
            itemsCapped++;
    }
    return {
        intents: ledger.size,
        variantExecutions,
        variantConfirmed,
        itemsWithVariants,
        itemsCapped,
    };
}
/** One-line honest summary for the battery coverage line. */
export function variantCountLine(c) {
    return (`Variant executions: ${c.variantExecutions} across ${c.itemsWithVariants} items ` +
        `(${c.variantConfirmed} confirmed via variants${c.itemsCapped > 0 ? `, ${c.itemsCapped} items hit the per-item cap` : ""}). ` +
        `Intents (${c.intents}) and executions are counted separately — never merged.`);
}
/** Per-item variant progress suffix for the reconciliation list. */
export function variantProgressSuffix(v) {
    const vp = v.variants;
    if (!vp)
        return "";
    return ` [variants ${vp.executed}/${vp.planned} executed, ${vp.confirmed} confirmed]`;
}
//# sourceMappingURL=reporting.js.map