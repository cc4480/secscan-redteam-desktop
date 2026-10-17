/**
 * Compliance pack finding/retest types + before/after evidence builder.
 */
import type { VulnerabilityRegistry } from "../../registry.js";
export interface PackFinding {
    id: string;
    severity: string;
    title: string;
    attackIds: string[];
    /** Compliance control ids exercised by this finding. */
    controls: string[];
    evidence: string;
    fix: string;
    retest: string;
    status: string;
    /** Named human operator accountable for this finding (v0.17.0). */
    accountableOperator: string;
}
export interface RetestObservation {
    engagementId: string;
    date: string;
    severity: string;
    evidenceRef: string;
}
export interface RetestEntry {
    vulnClass: string;
    /** Earliest observation across all engagements (the "before"). */
    firstSeen: RetestObservation;
    /** Latest observation (the "after" — possibly this engagement). */
    latest: RetestObservation;
    observationCount: number;
}
export declare function buildRetestEvidence(registry: VulnerabilityRegistry): RetestEntry[];
/** Human-readable markdown rendering of the pack (written next to report.md). */
