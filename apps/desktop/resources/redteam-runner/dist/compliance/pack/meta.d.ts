/**
 * Compliance evidence pack builder (v0.12.0): metadata, methodology,
 * findings table, coverage, honest limits, safety + approval sections.
 */
import type { Finding, OperationPlan, RulesOfEngagement } from "../../types.js";
import type { VulnerabilityRegistry } from "../../registry.js";
import type { SafetyManifest } from "../../safety/index.js";
import type { ApprovalEntry, AutonomyTier } from "../../accountability/index.js";
import type { PackFinding, RetestEntry } from "./findings.js";
export interface CompliancePackInput {
    engagementId: string;
    client?: string;
    /** Named human operator accountable for the engagement. */
    operator?: string;
    target: string;
    mode: "red" | "black";
    objective: string;
    scope: string[];
    /** Server-authoritative ownership proof (DNS TXT verification). */
    verificationProof?: string;
    roe: RulesOfEngagement;
    testStart: string;
    testEnd: string;
    plan?: OperationPlan | null;
    findings: Finding[];
    /** Runner-computed battery coverage line, for the methodology appendix. */
    batteryCoverageNote?: string;
    registry: VulnerabilityRegistry;
    generatedAt?: string;
    /**
     * v0.13.0 safety case: the engagement's machine-readable safety manifest
     * (built by the runner at report time). Embedded as the pack's safety
     * section — the artifact a buyer's security team reviews.
     */
    safety?: SafetyManifest;
    /**
     * v0.17.0 accountability: the append-only approval log and the autonomy
     * tier in force. Defaults: empty log, Tier 2 (chain).
     */
    approvals?: ApprovalEntry[];
    autonomyTier?: AutonomyTier;
}
export interface CompliancePack {
    engagementId: string;
    client?: string;
    operator: string;
    generatedAt: string;
    metadata: {
        target: string;
        mode: string;
        objective: string;
        scope: string[];
        testWindow: {
            start: string;
            end: string;
        };
        authorizationProof: string;
        rulesOfEngagement: RulesOfEngagement;
    };
    methodology: {
        approach: string;
        phases: string[];
        toolsUsed: string[];
        validationStandard: string;
        exclusions: string[];
        authorization: string;
    };
    findings: PackFinding[];
    retestEvidence: RetestEntry[];
    coverage: {
        controlsExercised: number;
        controlsTotal: number;
        /** Control id → finding ids exercising it. */
        controlFindings: Record<string, string[]>;
    };
    /**
     * v0.13.0 safety case: the engagement's safety manifest (mechanical
     * protections, configuration, zero-disruption record, residual risks).
     * Present when the runner built it at report time.
     */
    safety?: SafetyManifest;
    /**
     * v0.17.0 accountability: the append-only approval log (tier declared,
     * tier escalations, production confirmation…) and the autonomy tier in
     * force. Auditors see who approved what, when.
     */
    approvals: ApprovalEntry[];
    autonomyTier: AutonomyTier;
    autonomyTierName: string;
    honestLimits: string[];
}
/** The tools the runner can put in play — named exactly as the agents know them. */
export declare const METHODOLOGY_TOOLS: string[];
/** What the runner never does — stated in the methodology so a QSA sees the boundary. */
export declare const METHODOLOGY_EXCLUSIONS: string[];
export declare function buildCompliancePack(input: CompliancePackInput): CompliancePack;
/**
 * Before/after per vulnerability class across the whole registry history.
 * Honest and mechanical: earliest observation vs latest observation, with
 * engagement ids and evidence refs. Remediation status itself comes from
 * each finding's retest field — the pack does not infer it.
 */
