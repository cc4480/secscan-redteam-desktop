/**
 * Safety-manifest artifacts (v0.19.0 refactor — extracted from reportPhase).
 *
 * The machine-readable safety manifest — every protection that was
 * mechanically active, what it did, and the zero-disruption record derived
 * from the audit log. Written next to report.md.
 * Its own try/catch: a manifest failure must never break the report.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEvents } from "../events.js";
import { buildSafetyManifest, buildZeroDisruptionRecord, disruptionVerdict, renderSafetyManifestMarkdown } from "../safety/index.js";
import { buildEngagementMeta, renderReportHtml } from "./html.js";
export function writeSafetyArtifacts(ctx) {
    let safetyManifest;
    try {
        const events = readEvents(ctx.events.dir);
        const zeroDisruption = buildZeroDisruptionRecord(events);
        safetyManifest = buildSafetyManifest({
            engagementId: ctx.events.engagementId,
            environment: ctx.safety.environment,
            productionConfirmed: ctx.safety.productionConfirmed,
            scopeAllowlist: ctx.hosts,
            rpsPerHost: ctx.safety.rpsPerHost,
            burst: ctx.safety.rpsPerHost,
            productionCapApplied: ctx.safety.productionCapApplied,
            throttledMs: Math.round(ctx.safety.limiter.throttledMs),
            acquires: ctx.safety.limiter.acquires,
            operator: ctx.input.operatorName || process.env["REDTEAM_OPERATOR"]?.trim() || "(operator name not supplied — set REDTEAM_OPERATOR)",
            // Q-LOCKOUT: the interlock's numbers ride the manifest (§5.6 — if
            // it is not in the manifest, it did not happen).
            lockout: ctx.safety.lockout?.manifestData(),
            zeroDisruption,
            disruptionVerdict: disruptionVerdict(zeroDisruption),
            // v0.17.0 accountability: the autonomy tier and its approval trail are
            // part of the safety manifest — buyers see the control boundary.
            autonomy: {
                tier: ctx.tier.current,
                declaredTier: ctx.tier.declared,
                approvals: ctx.approvals.list(),
            },
        });
        writeFileSync(join(ctx.events.dir, "safety-manifest.json"), JSON.stringify(safetyManifest, null, 2));
        const manifestMd = renderSafetyManifestMarkdown(safetyManifest);
        writeFileSync(join(ctx.events.dir, "safety-manifest.md"), manifestMd);
        writeFileSync(join(ctx.events.dir, "safety-manifest.html"), renderReportHtml({
            title: "Safety Manifest",
            meta: buildEngagementMeta(ctx, []),
            markdown: manifestMd,
            showStrip: false,
        }));
        ctx.events.append({
            phase: "report",
            actor: "runner",
            action: "safety_manifest",
            result: `Safety manifest written (env=${safetyManifest.environment}, ${safetyManifest.rateLimit.rpsPerHost}rps/host, ${safetyManifest.disruptionVerdict.split(";")[0]}).`,
        });
    }
    catch (err) {
        ctx.events.append({
            phase: "report",
            actor: "runner",
            action: "safety_manifest_failed",
            result: `Safety manifest generation failed (report.md unaffected): ${err.message}`,
        });
    }
    return safetyManifest;
}
//# sourceMappingURL=safety.js.map