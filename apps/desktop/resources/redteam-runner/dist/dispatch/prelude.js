/** Optional string arg: trimmed, or undefined when absent/blank. */
export function optStr(v) {
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
/** Optional positive-number arg, or undefined when absent/invalid. */
export function numArg(v) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
/**
 * Optional string-list arg: trimmed non-empty entries, or undefined when the
 * arg is absent or yields nothing. Was copy-pasted identically into the nmap,
 * nuclei and xtool handlers.
 */
export function strListArg(args, key) {
    const v = args[key];
    if (!Array.isArray(v))
        return undefined;
    const out = v.filter((x) => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
    return out.length ? out : undefined;
}
/**
 * Record a tagged battery category against the engagement's coverage — the
 * identical bookkeeping every target-facing handler performs before it sends
 * traffic. It appeared, byte-for-byte apart from the cell key, in six handlers
 * (host, msf, nmap, nuclei, web, xtool); one copy means the category list and
 * the coverage-state shape cannot drift between them.
 *
 * Does NOT touch `ctx.probesUsed`: handlers disagree on whether an attempt
 * counts as a probe (xtool only counts when it is not offline), so each caller
 * keeps that decision next to its own call.
 *
 * `targetProfile` names the per-target battery cell. Omit it only when the tool
 * has no target cell to attribute (offline jobs); the global category coverage
 * is recorded regardless.
 */
export function noteCategoryCoverage(ctx, category, targetProfile) {
    if (!category)
        return;
    ctx.coverage.add(category);
    if (ctx.input.fullBattery && targetProfile) {
        let set = ctx.targetCoverage.get(targetProfile);
        if (!set) {
            set = new Set();
            ctx.targetCoverage.set(targetProfile, set);
        }
        set.add(category);
    }
    ctx.events.updateState({
        batteryCoverage: {
            logic: ctx.coverage.has("logic") ? 1 : 0,
            functionality: ctx.coverage.has("functionality") ? 1 : 0,
            validation: ctx.coverage.has("validation") ? 1 : 0,
        },
    });
}
//# sourceMappingURL=prelude.js.map