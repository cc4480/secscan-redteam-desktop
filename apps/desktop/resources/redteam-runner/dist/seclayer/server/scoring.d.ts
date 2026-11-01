import { Finding, Severity } from "../src/types.js";
export declare const SEVERITY_WEIGHTS: Record<Severity, number>;
export declare const SCORE_FLOOR = 10;
export declare const HEURISTIC_CONFIDENCE_FACTOR: Record<"medium" | "low", number>;
export declare const HEURISTIC_DEDUCTION_CAP = 40;
export declare const CONFIRMED_SEVERITY_CEILING: Partial<Record<Severity, number>>;
export declare function normalizeSeverity(sev: string | undefined): Severity;
export declare function isProven(finding: Pick<Finding, "evidence">): boolean;
export declare function isConfirmed(finding: Pick<Finding, "confidence" | "evidence">): boolean;
export type ResultTier = "PASS" | "PROVEN" | "CONFIRMED" | "NEEDS VERIFICATION";
export declare function resultTier(f: Pick<Finding, "confidence" | "evidence" | "severity">): ResultTier;
/** The live-feed marker for a tier: "✓ PROVEN", "⚠ NEEDS VERIFICATION", … */
export declare function resultMarker(tier: ResultTier): string;
export type Grade = "A" | "B" | "C" | "D" | "F" | "N/A";
export declare function gradeForScore(score: number): Grade;
export type RiskLabel = "SECURE" | "INFO" | "LOW RISK" | "MODERATE" | "HIGH RISK" | "CRITICAL";
export declare function riskLabelForSeverity(sev: Severity | null): RiskLabel;
export declare function highestSeverity(findings: Finding[]): Severity | null;
export interface SecurityPosture {
    score: number;
    grade: Grade;
    severity: Severity;
    postureRating: RiskLabel;
    findingsBySeverity: Record<Severity, number>;
    activeCount: number;
    confirmedCount: number;
    needsVerificationCount: number;
    intercepted: boolean;
}
export declare function deriveSecurityPosture(findings: Finding[]): SecurityPosture;
export declare function scoreFindings(findings: Finding[]): {
    score: number;
    severity: Severity;
};
export type BannerLevel = "critical" | "warning" | "notice";
export interface PostureBanner {
    level: BannerLevel;
    title: string;
    message: string;
}
export declare function bannerForPosture(findings: Finding[]): PostureBanner | null;
