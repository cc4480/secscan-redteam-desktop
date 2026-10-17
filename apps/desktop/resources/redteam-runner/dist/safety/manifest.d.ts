/**
 * Safety manifest (v0.13.0) — the production safety case, machine-readable.
 *
 * One engagement → one manifest, written next to report.md and embedded in
 * the compliance pack's safety section. It states every protection that was
 * mechanically active, the configuration it ran with, what it did during
 * the engagement, and the residual risks — honestly. We never claim "zero
 * risk"; we claim specific protections and what they mechanically enforce.
 */
import type { TestEnvironment } from "./graduation.js";
import type { ZeroDisruptionRecord } from "./disruption.js";
import type { ApprovalEntry, AutonomyTier } from "../accountability/index.js";
export declare const SAFETY_MANIFEST_VERSION = "v0.17.0";
/** The mechanical protections — stated as what the RUNNER enforces, not what the agents were told. */
export declare const PROTECTIONS_IN_FORCE: string[];
/**
 * Residual risks — stated plainly in the manifest and docs/safety.md.
 * A safety case that lists no residual risks is marketing, not engineering.
 */
export declare const RESIDUAL_RISKS: string[];
export interface SafetyManifest {
    manifestVersion: string;
    engagementId: string;
    generatedAt: string;
    environment: TestEnvironment;
    productionConfirmed: boolean;
    scopeAllowlist: string[];
    rateLimit: {
        rpsPerHost: number;
        burst: number;
        productionCapApplied: boolean;
        throttledMs: number;
        acquires: number;
    };
    killSwitch: {
        armed: boolean;
        aborts: number;
    };
    destructiveDenylist: {
        version: string;
        patternCount: number;
        patterns: string[];
    };
    payloadPolicy: "canary-only";
    dosPolicy: "excluded-always";
    humanOverride: {
        operator: string;
        abortPath: string;
        responseExpectation: string;
    };
    piiRedaction: {
        enabled: boolean;
        patterns: string[];
    };
    autoHalt: {
        consecutiveThreshold: number;
        windowSize: number;
        windowFailureRate: number;
        haltedTargets: string[];
        haltCount: number;
    };
    protectionsInForce: string[];
    zeroDisruption: ZeroDisruptionRecord;
    disruptionVerdict: string;
    residualRisks: string[];
    /**
     * v0.17.0 accountability: the autonomy tier in force and its approval
     * trail. A control boundary, stated plainly — never a safety guarantee.
     */
    autonomy: {
        tier: AutonomyTier;
        tierName: string;
        tierDescription: string;
        declaredTier: AutonomyTier;
        approvals: ApprovalEntry[];
    };
}
export interface ManifestInputs {
    engagementId: string;
    environment: TestEnvironment;
    productionConfirmed: boolean;
    scopeAllowlist: string[];
    rpsPerHost: number;
    burst: number;
    productionCapApplied: boolean;
    throttledMs: number;
    acquires: number;
    killSwitchAborts: number;
    operator: string;
    autoHalt: {
        consecutiveThreshold: number;
        windowSize: number;
        windowFailureRate: number;
        haltedTargets: string[];
        haltCount: number;
    };
    zeroDisruption: ZeroDisruptionRecord;
    disruptionVerdict: string;
    generatedAt?: string;
    /**
     * v0.17.0 accountability: tier in force + approval trail. Optional for
     * backward compatibility — defaults to Tier 2 (chain) declared, no
     * approvals (the pre-tier manifest shape).
     */
    autonomy?: {
        tier: AutonomyTier;
        declaredTier: AutonomyTier;
        approvals: ApprovalEntry[];
    };
}
export declare function buildSafetyManifest(input: ManifestInputs): SafetyManifest;
/** Markdown rendering for safety-manifest.md (human-readable twin of the JSON). */
export declare function renderSafetyManifestMarkdown(m: SafetyManifest): string;
