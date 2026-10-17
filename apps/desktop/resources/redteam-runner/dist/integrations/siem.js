/**
 * INTEGRATIONS — SIEM export (v0.15.0).
 *
 * Every engagement writes `siem-events.jsonl`: one flat JSON event per
 * finding, per proof bundle, plus a safety-manifest summary and an
 * engagement-completed event. The schema is stable and documented (see
 * docs/integrations.md) — Splunk / Microsoft Sentinel ingest it as-is;
 * no vendor SDK is involved.
 *
 * Field contract (every event carries all of these):
 *   timestamp, vendor, product, engagement_id, event_type, severity,
 *   title, target, operator, attack_ids, cve, bundle_id, detail
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export const SIEM_VENDOR = "secscan-redteam";
export const SIEM_PRODUCT = "redteam-runner";
export const SIEM_SCHEMA_VERSION = 1;
function base(input, type) {
    return {
        schema_version: SIEM_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        vendor: SIEM_VENDOR,
        product: SIEM_PRODUCT,
        engagement_id: input.engagementId,
        event_type: type,
        target: input.target,
        operator: input.operator,
    };
}
export function buildSiemEvents(input) {
    const events = [];
    for (const f of input.findings) {
        const bundle = input.bundles.get(f.id) ?? null;
        events.push({
            ...base(input, "finding"),
            severity: f.severity,
            title: f.title,
            attack_ids: f.attackIds,
            cve: bundle?.cve ?? null,
            bundle_id: bundle?.bundleId ?? null,
            detail: `Finding ${f.id} [${f.status}]: ${f.evidence.slice(0, 300)}`,
        });
        if (bundle) {
            events.push({
                ...base(input, "proof_bundle"),
                severity: f.severity,
                title: `Proof bundle for ${f.id}`,
                attack_ids: bundle.attackIds,
                cve: bundle.cve ?? null,
                bundle_id: bundle.bundleId,
                detail: `${bundle.validationTier} proof: ${bundle.proves.slice(0, 300)}`,
            });
        }
    }
    events.push({
        ...base(input, "safety_summary"),
        severity: "info",
        title: "Safety summary",
        attack_ids: [],
        cve: null,
        bundle_id: null,
        detail: input.safetySummary.slice(0, 500),
    });
    const counts = Object.entries(input.severityCounts)
        .filter(([, n]) => n > 0)
        .map(([s, n]) => `${s}:${n}`)
        .join(" ");
    events.push({
        ...base(input, "engagement_completed"),
        severity: "info",
        title: "Engagement completed",
        attack_ids: [],
        cve: null,
        bundle_id: null,
        detail: `Findings — ${counts || "none"}.`,
    });
    return events;
}
/** Write the JSONL file next to the report. Returns the path written. */
export function writeSiemEvents(dir, events) {
    const path = join(dir, "siem-events.jsonl");
    writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    return path;
}
//# sourceMappingURL=siem.js.map