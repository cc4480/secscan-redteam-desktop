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
import type { Finding } from "../types.js";
import type { PocBundle } from "../proof/bundle.js";
export declare const SIEM_VENDOR = "secscan-redteam";
export declare const SIEM_PRODUCT = "redteam-runner";
export declare const SIEM_SCHEMA_VERSION = 1;
export type SiemEventType = "finding" | "proof_bundle" | "safety_summary" | "engagement_completed";
export interface SiemEvent {
    schema_version: number;
    timestamp: string;
    vendor: string;
    product: string;
    engagement_id: string;
    event_type: SiemEventType;
    severity: string;
    title: string;
    target: string;
    operator: string;
    attack_ids: string[];
    cve: string | null;
    bundle_id: string | null;
    /** Short human-readable detail; secrets/PII already redacted upstream. */
    detail: string;
}
export interface SiemBuildInput {
    engagementId: string;
    target: string;
    operator: string;
    findings: Finding[];
    /** findingId → bundle (only confirmed findings with a validation signal have one). */
    bundles: Map<string, PocBundle>;
    /** One-line safety summary, e.g. from the zero-disruption record. */
    safetySummary: string;
    severityCounts: Record<string, number>;
}
export declare function buildSiemEvents(input: SiemBuildInput): SiemEvent[];
/** Write the JSONL file next to the report. Returns the path written. */
export declare function writeSiemEvents(dir: string, events: SiemEvent[]): string;
