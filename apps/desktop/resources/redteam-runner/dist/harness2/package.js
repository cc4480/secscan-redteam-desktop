/**
 * Harness2 proposal package (H2-P2, spec section 6): versioned schema + builder.
 *
 * ONE self-contained, versioned document per tuning cycle, seven sections in a
 * fixed, machine-checked order (see ./package-parse.ts):
 *   1 header        package_id, date, format_version, tuner_version, target_class,
 *                   mode, base_harness_version, active_layer_set
 *   2 components    FULL contents of the 7 editable components; guardrails by
 *                   path + sha256 + "PINNED - DO NOT PROPOSE CHANGES"
 *   3 contrasts     2-3 pairs (run_id_high/run_id_low) with FULL step logs from
 *                   the section-5 steps table, per-run metrics and the tuner's
 *                   selection-criteria statement
 *   4 metrics       window means per target class, N stated
 *   5 experience    the class's EXPERIENCE.md FULL text
 *   6 constraints   guardrails pinned, k=1, propose-only, probe token budget
 *   7 checklist     machine-checkable field list incl. delimiter balance
 *
 * PACKAGE_FORMAT_VERSION is carried in the header; older documents stay readable
 * and a newer one is rejected (parsePackageDocument). Section-9 selection and
 * section-8 scoring are NOT reimplemented here: ./package-pairs.ts adapts the
 * canonical pair-select.ts/pair-runs.ts/scoring.ts.
 *
 * Implementation split (all inside the 300-line budget):
 *   package-component-map.ts  path map, verbatim reads, pinned guardrails
 *   package-pairs.ts          section 3+4 adapter over canonical selection
 *   package-experience.ts     EXPERIENCE.md full text + entry parsing
 *   package-instructions.ts   section 6 constraints + required reply format
 *   package-parse.ts          section parsing, checklist, completeness
 *   package-render.ts         section rendering, paste-ready text, atomic writer
 *   package-chunk.ts          section 10 chunking, delimiters, relay, assembly
 *   package-reply.ts          section 10 @@PROPOSAL/@@FILE reply parser + pins
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { resolveHarness2Paths } from "./contract.js";
import { findAppRoot, readGitCommit, readRunnerVersion, resolveLayerIds } from "./harness-stamp.js";
import { findRepoRoot, readComponentFiles, readPinnedGuardrails } from "./package-component-map.js";
import { DEFAULT_PAIR_COUNT, buildPackageMetrics, selectPackageContrasts } from "./package-pairs.js";
import { readClassExperienceText, sanitizeTargetClass } from "./package-experience.js";
import { buildConstraints } from "./package-instructions.js";
import { finalizePackage, renderPackageDocument } from "./package-render.js";
import { splitPackage } from "./package-chunk.js";
/** Empty checklist used before the rendered text exists; finalizePackage fills it. */
export const EMPTY_CHECKLIST = { items: [], complete: false, delimitersBalanced: false, beginCount: 0, endCount: 0 };
/** Raised when a class has too few usable runs for a package (cold start). */
export class InsufficientDataError extends Error {
    targetClass;
    usableRuns;
    windowSize;
    windowDays;
    constructor(targetClass, usableRuns, windowSize, windowDays, method) {
        super(`INSUFFICIENT_DATA for ${targetClass}: ${usableRuns} usable run(s) in the window (${windowSize} run(s), ${windowDays} day fallback; ${method}); at least 4 are required for a package`);
        this.name = "InsufficientDataError";
        this.targetClass = targetClass;
        this.usableRuns = usableRuns;
        this.windowSize = windowSize;
        this.windowDays = windowDays;
    }
}
function snapshotOf(row) {
    return {
        runId: row.runId,
        ts: row.ts,
        targetClass: row.targetClass,
        ...(row.targetSubclass !== undefined ? { targetSubclass: row.targetSubclass } : {}),
        ...(row.targetId !== undefined ? { targetId: row.targetId } : {}),
        harnessVersion: row.harnessVersion,
        layerSet: row.layerSet,
        outcome: row.outcome,
        success: row.success,
        vulnsFound: row.vulnsFound,
        falsePositives: row.falsePositives,
        claimsTotal: row.claimsTotal,
        steps: row.stepsCount,
        tokens: row.tokensTotal,
        crashed: row.crashed,
        failureMode: row.failureMode,
    };
}
function packageRun(detail) {
    return { snapshot: snapshotOf(detail.run), steps: detail.steps };
}
/** Deterministic package id from the date, class and contrasted run ids. */
export function makePackageId(date, targetClass, runIds) {
    const digest = createHash("sha256").update([date, targetClass, ...runIds].join("\n"), "utf8").digest("hex").slice(0, 8);
    return `pkg-${date}-${sanitizeTargetClass(targetClass)}-${digest}`;
}
/** Assemble the self-contained section-6 package for one target class. */
export function buildProposalPackage(input) {
    const environment = input.environment ?? process.env;
    const repoRoot = input.repoRoot ?? findRepoRoot();
    const appRoot = input.appRoot ?? (input.repoRoot !== undefined ? join(repoRoot, "apps", "redteam-runner") : findAppRoot());
    const experienceDir = input.experienceDir ?? resolveHarness2Paths(environment).experience;
    const now = input.now === undefined ? new Date() : new Date(input.now);
    if (Number.isNaN(now.getTime()))
        throw new Error(`[harness2] invalid now value for package build: ${String(input.now)}`);
    const nowMs = now.getTime();
    const date = now.toISOString().slice(0, 10);
    const selection = selectPackageContrasts({ store: input.store, targetClass: input.targetClass, nowMs, maxPairs: input.maxPairs ?? DEFAULT_PAIR_COUNT });
    const mode = selection.mode === "INSUFFICIENT_DATA" ? undefined : selection.mode;
    if (mode === undefined)
        throw new InsufficientDataError(input.targetClass, selection.usableRuns, selection.windowSize, selection.windowDays, selection.windowMethod);
    const pairs = selection.pairs.map((entry, index) => {
        const highDetail = input.store.getRun(entry.high.runId);
        const lowDetail = input.store.getRun(entry.low.runId);
        if (highDetail === null || lowDetail === null)
            throw new Error(`[harness2] contrasted run vanished from the store: ${entry.high.runId} / ${entry.low.runId}`);
        return { index: index + 1, runIdHigh: entry.high.runId, runIdLow: entry.low.runId, high: packageRun(highDetail), low: packageRun(lowDetail), note: entry.note };
    });
    const components = readComponentFiles(repoRoot);
    const guardrails = readPinnedGuardrails(repoRoot);
    const header = {
        packageId: makePackageId(date, input.targetClass, pairs.flatMap((pair) => [pair.runIdHigh, pair.runIdLow])),
        date,
        formatVersion: "6.0",
        tunerVersion: readRunnerVersion(appRoot),
        targetClass: input.targetClass,
        mode,
        baseHarnessVersion: readGitCommit(repoRoot, environment) ?? "unknown",
        activeLayerSet: selection.latestLayerSet.length > 0 ? selection.latestLayerSet : resolveLayerIds(environment),
    };
    const criteria = {
        windowSize: selection.windowSize,
        windowDays: selection.windowDays,
        windowMethod: selection.windowMethod,
        quartileMethod: selection.quartileMethod,
        failureModeCoverage: selection.failureModeCoverage,
        mode,
        modeReason: selection.modeReason,
        pairsFormed: pairs.length,
        representativeRunIds: selection.representativeRunIds,
    };
    return finalizePackage({
        formatVersion: "6.0",
        header,
        components,
        guardrails,
        pairs,
        selection: criteria,
        metrics: buildPackageMetrics(input.store, input.targetClass, nowMs),
        experience: readClassExperienceText(experienceDir, input.targetClass),
        constraints: buildConstraints(guardrails.map((entry) => entry.path), environment),
        checklist: EMPTY_CHECKLIST,
    });
}
/** Section 10 serialize step: render the package text and split it on line boundaries. */
export function serializePackageParts(doc) {
    const finalDoc = doc.checklist.items.length === 0 ? finalizePackage(doc) : doc;
    return splitPackage(renderPackageDocument(finalDoc), finalDoc.header.packageId);
}
export * from "./package-component-map.js";
export * from "./package-pairs.js";
export * from "./package-experience.js";
export * from "./package-instructions.js";
export * from "./package-parse.js";
export * from "./package-render.js";
export * from "./package-chunk.js";
export * from "./package-reply.js";
//# sourceMappingURL=package.js.map