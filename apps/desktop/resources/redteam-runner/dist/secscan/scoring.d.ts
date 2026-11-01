/**
 * Confidence scoring — assigns a 0–100 confidence score to every finding.
 *
 * Confidence ≠ Severity. Severity (CVSS) measures impact if exploited.
 * Confidence measures how certain we are that the finding is real and
 * reproducible, not a false positive.
 *
 * Model: base score by detection class + modifiers for:
 *   - Evidence quality (multi-line request/response context)
 *   - Number of independent detection signals
 *   - Taxonomic specificity (CWE / WSTG presence = well-defined finding class)
 *
 * The auto-enrichment pass runs in the scanner orchestrator so individual
 * check modules don't need to import this file directly.
 */
import type { ScanVulnerability } from "./scanner.js";
export type DetectionClass = 
/** Payload executed and file content / redirect target confirmed in response */
"confirmed_exploit"
/** Sensitive file fetched and body matched an expected content pattern */
 | "confirmed_exposure"
/** Active HTTP probe sent; meaningful response difference observed */
 | "active_behavioral"
/** Passive check with body or header regex validation */
 | "validated_passive"
/** Security header completely absent from response */
 | "header_absent"
/** Security header present but value is insecure or misconfigured */
 | "header_misconfigured"
/** DNS record absent or misconfigured (deterministic lookup) */
 | "dns_record"
/** Technology version string mapped to CVE — may have false positives */
 | "version_heuristic"
/** NXDOMAIN + CNAME pattern — possible subdomain takeover, needs verification */
 | "subdomain_heuristic"
/** Regex match in JS/HTML source — pattern-based, occasional false positives */
 | "secret_regex"
/** Low-signal informational finding */
 | "info_disclosure";
export interface ConfidenceOpts {
    /** Number of independent detection signals (default 1); each extra adds +5, capped at +15 */
    signals?: number;
    /** Multi-line evidence (request + response context) boosts score */
    evidence?: string | null;
    /** CWE ID presence means a well-defined vulnerability class → +3 */
    cweId?: string | null;
    /** WSTG ID means a formally specified test case → +2 */
    wstgId?: string | null;
}
export declare function computeConfidence(detectionClass: DetectionClass, opts?: ConfidenceOpts): number;
/**
 * Groups findings that share the same root cause (by synonym catalog or exact match).
 * When multiple independent detection methods fire for the same underlying vulnerability,
 * they are merged into a single finding with a confidence floor of 90 and the richest
 * evidence text.
 *
 * Findings that are unique (no duplicate root cause) pass through unchanged.
 */
export declare function corroborateMerge(vulns: ScanVulnerability[]): ScanVulnerability[];
/**
 * Post-processing pass run by the scanner orchestrator.
 * Assigns confidence to every vulnerability that doesn't already have one,
 * inferring the detection class from available finding metadata.
 */
export declare function autoEnrichConfidence(vulns: ScanVulnerability[]): ScanVulnerability[];
