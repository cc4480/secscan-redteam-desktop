/**
 * Recall pack assembly and injection, extracted from `lifecycle.ts` to
 * keep that module inside the 300-line file budget: the store-to-recall
 * adapter, the legacy EXPERIENCE slice, the recall event line, and the
 * two pack moments. Behaviour is unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHarness2Paths } from "../harness2/contract.js";
import { readExperienceReport } from "../harness2/experience-record.js";
import { assembleMemoryPack } from "./recall.js";
import { computeUnitId } from "./schema.js";
import { normalizeHost, scopeKeyForClass } from "./scope.js";
import { sourceKeyFor } from "./trust.js";
import { VIEW_GENERATOR_VERSION, atomicWriteText, ensureViews, generateUnitViews, readViewsIndex, unitViewSourceHash, } from "./views.js";
import { deriveEngagementScope, parseMemoryBudget, requireSession } from "./lifecycle-session.js";
/**
 * Adapt the real store to recall's seam. `ensureUnitViews` regenerates
 * the named units' views per-unit first (a unit that cannot regenerate
 * is a VIEW_STALE exclusion, §8 row 9 — never a recall crash), then runs
 * the directory-threshold pass; directories left stale are reported
 * from the views index with their pending counts.
 *
 * @param store - The open store.
 * @param paths - The store paths.
 * @param nowIso - Timestamp for refreshes and receipts.
 * @returns The recall-facing store adapter.
 */
export function recallStoreAdapter(store, paths, nowIso) {
    return {
        listActiveUnits: () => store.listUnits(),
        ensureUnitViews: (unitIds) => {
            const refreshed = [];
            const failed = [];
            const units = [];
            for (const id of unitIds) {
                const unit = store.getUnit(id);
                if (!unit) {
                    failed.push(id);
                    continue;
                }
                const expected = unitViewSourceHash(unit);
                if (unit.views.sourceHash === expected && unit.views.generator === VIEW_GENERATOR_VERSION && !unit.views.stale) {
                    units.push(unit);
                    continue;
                }
                try {
                    const generated = generateUnitViews(unit, "active");
                    units.push({
                        ...unit,
                        views: { ...generated, sourceHash: expected, generatedAt: nowIso, generator: VIEW_GENERATOR_VERSION, stale: false },
                    });
                    refreshed.push(id);
                }
                catch {
                    failed.push(id); // VIEW_BUDGET_EXCEEDED etc. — excluded as VIEW_STALE by recall
                }
            }
            try {
                ensureViews(store, undefined, nowIso);
            }
            catch {
                // Directory refresh is threshold bookkeeping; a failure leaves
                // directories stale-but-readable, which the index read below
                // reports truthfully. Unit freshness above is already settled.
            }
            const index = readViewsIndex(paths);
            const staleDirs = Object.values(index.dirs)
                .filter((d) => d.stale || d.pendingUnitChanges > 0)
                .map((d) => ({ dir: d.dir, pendingUnitChanges: d.pendingUnitChanges }));
            return { refreshed, failed, staleDirs, units };
        },
        writeRecallReceipt: (receipt) => {
            atomicWriteText(join(paths.recallDir, `${receipt.receiptId}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
            return receipt.receiptId;
        },
    };
}
/**
 * The §6.6 legacy slice for this engagement's target class: active
 * EXPERIENCE.md records not yet projected into units, as neutral-base
 * (0.6) candidates. A missing/unreadable legacy store is an empty
 * slice — the legacy pool is a fallback, never a run failure.
 *
 * @param session - The memory session.
 * @returns The slice (candidates + the parser's skipped count).
 */
function buildLegacySlice(session) {
    try {
        const report = readExperienceReport(resolveHarness2Paths(process.env), session.targetClass);
        if (!report.exists)
            return { candidates: [], skipped: 0 };
        const candidates = [];
        for (const record of report.entries) {
            if (record.status.kind !== "active")
                continue;
            const refUri = `experience-record:${record.targetClass}/${record.date}/${record.layerId ?? "general"}/${record.cycleId}`;
            const unitId = computeUnitId(scopeKeyForClass(record.targetClass), "experience-lesson", record.changed, refUri);
            if (session.store.hasUnit(unitId))
                continue; // projected — the unit form governs (§6.6)
            candidates.push({
                unitId: `legacy:${record.targetClass}/${record.date}/${record.cycleId}`,
                sourceClass: "experience",
                sourceKey: sourceKeyFor("experience", "legacy"),
                claim: record.changed,
                tags: [record.targetClass],
                baseScore: 0.6,
                contentClass: "normal",
                independentCount: 0,
                scopeKey: scopeKeyForClass(record.targetClass),
                hasScope: true,
                hasTrustBlock: false,
                legacyExperience: true,
            });
        }
        return { candidates, skipped: report.skipped };
    }
    catch {
        return { candidates: [], skipped: 0 };
    }
}
/**
 * The `memory_recall` event body (§7.1): survivor unitIds + tiers and,
 * read back from the just-written receipt, the candidate/pruned/decayed
 * counts — the audit line an operator (or a later investigator) uses to
 * prove memory was consulted and what it returned.
 *
 * @param session - The memory session (receipt location).
 * @param phase - Which pack this was.
 * @param pack - The assembled pack.
 * @returns The event result text.
 */
function recallEventResult(session, phase, pack) {
    const survivors = pack.survivors.map((s) => `${s.unitId} [${s.tier}]`).join(", ") || "none";
    let counts = "";
    try {
        const receipt = JSON.parse(readFileSync(join(session.paths.recallDir, `${pack.receiptId}.json`), "utf8"));
        const bySource = Object.entries(receipt.candidatesBySource)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ");
        counts =
            ` · candidates ${bySource || "none"} · pruned ${receipt.pruned.length} · suppressed ${receipt.suppressedDuplicates.length}` +
                ` · decayed ${receipt.decayed.length} · stale-excluded ${receipt.viewStaleExcluded.length}`;
    }
    catch {
        counts = "";
    }
    return (`${phase} pack: receipt ${pack.receiptId} (recall/${pack.receiptId}.json) · survivors: ${survivors}` +
        `${pack.emptyReason ? ` · empty: ${pack.emptyReason}` : ""}${counts}`);
}
function assembleAndRecord(ctx, session, phase, query, eligibility) {
    const now = session.deps.now ? session.deps.now() : new Date();
    const pack = (session.deps.assemblePack ?? assembleMemoryPack)(recallStoreAdapter(session.store, session.paths, now.toISOString()), deriveEngagementScope(ctx), {
        phase,
        query,
        engagementId: ctx.events.engagementId,
        ...(eligibility ? { eligibility } : {}),
        budget: parseMemoryBudget(process.env),
        now,
        legacy: buildLegacySlice(session),
    });
    session.state.recallReceiptIds.push(pack.receiptId);
    if (phase === "start")
        session.state.startPack = pack;
    else
        session.state.exploitPack = pack;
    ctx.events.append({
        phase: phase === "start" ? "authorize" : "exploit",
        actor: "runner",
        action: "memory_recall",
        result: recallEventResult(session, phase, pack),
    });
    return pack;
}
/**
 * Moment 2 (§7.1): the start pack — after authorization succeeds,
 * before planning. Query = objective + target + mode.
 *
 * @param ctx - The run context (post-authorize).
 * @returns The assembled pack (also cached on the memory state).
 */
export function injectStartMemory(ctx) {
    const session = requireSession(ctx);
    const query = `${ctx.input.objective} ${ctx.input.target} ${ctx.input.mode}`;
    return assembleAndRecord(ctx, session, "start", query);
}
/**
 * Moment 3 (§7.1): the refresh pack — after recon, with the fingerprint.
 * Query adds stack/appType and the registry hits' vuln classes;
 * eligibility carries the ROE deny set and the class/stack context.
 *
 * @param ctx - The run context (post-recon).
 * @returns The assembled pack (also cached on the memory state).
 */
export function injectExploitMemory(ctx) {
    const session = requireSession(ctx);
    const hitClasses = [...new Set(ctx.registryHits.map((h) => h.vulnClass).filter((v) => typeof v === "string"))];
    const query = [
        ctx.input.objective,
        ctx.input.target,
        ...ctx.fingerprint.stack,
        ctx.fingerprint.appType,
        ...hitClasses,
    ].join(" ");
    return assembleAndRecord(ctx, session, "exploit", query, {
        outOfScopeHosts: (ctx.input.roe.outOfScope ?? []).map((h) => normalizeHost(h)),
        targetClass: session.targetClass,
        stack: ctx.fingerprint.stack,
        appType: ctx.fingerprint.appType,
    });
}
//# sourceMappingURL=lifecycle-recall.js.map