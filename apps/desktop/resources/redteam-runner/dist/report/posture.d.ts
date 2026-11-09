/**
 * Local posture scoring — the runner's own severity-weighted grade.
 *
 * Until 2026-11-08 the report grade came from the vendored Seclayer
 * scoring engine (src/seclayer/, a byte-frozen as-is copy). That unit
 * was extracted from the tree, and this module is the replacement the
 * grading seam (report/grading.ts) now derives from: a simpler local
 * score over the engagement's CONFIRMED findings only — the grading
 * seam filters killed/deferred findings out before anything reaches
 * here, so every input finding deducts its full severity weight.
 *
 * The math (kept deliberately small):
 *   - severity weights: critical 35 / high 25 / medium 15 / low 5 /
 *     info 0, deducted from 100;
 *   - the grade is anchored to the worst severity present: one
 *     critical caps the score at 20, one high at 45 — count alone
 *     cannot produce an F;
 *   - the score floors at 10;
 *   - letter bands: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F.
 */
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Grade = "A" | "B" | "C" | "D" | "F" | "N/A";
export type RiskLabel = "SECURE" | "INFO" | "LOW RISK" | "MODERATE" | "HIGH RISK" | "CRITICAL";
/** One confirmed finding, reduced to what the score reads. */
export interface PostureFinding {
    severity: Severity;
    title: string;
}
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
/** Derive every risk figure the report displays from the confirmed set. */
export declare function deriveSecurityPosture(findings: PostureFinding[]): SecurityPosture;
export type BannerLevel = "critical" | "warning" | "notice";
export interface PostureBanner {
    level: BannerLevel;
    title: string;
    message: string;
}
/**
 * Severity-proportionate warning banner. Returns null when there is
 * nothing to warn about; for an INFO/LOW worst case it returns a calm
 * "notice" (never a red "fix immediately" alarm). The message is
 * derived from the actual highest-severity finding.
 */
export declare function bannerForPosture(findings: PostureFinding[]): PostureBanner | null;
