/**
 * The unified report token system — one table every report component reads.
 *
 * Visual system: Seclayer's zinc-black theme and severity tokens (adopted
 * verbatim from the design study, Part D4), SecScan's cover composition and
 * print discipline. Severity colour is a status palette: it is always shown
 * next to its text label, never colour-alone.
 */
export type SeverityName = "critical" | "high" | "medium" | "low" | "info";
/** Worst-first severity order — chips, bars, and card sorting all read this. */
export declare const SEVERITY_ORDER: readonly SeverityName[];
export interface SeverityToken {
    hex: string;
    /** Darker print variant (print stylesheet swaps the CSS var to this). */
    printHex: string;
    label: string;
}
/** Seclayer SEVERITY_TOKENS, verbatim hexes; print variants per SecScan's
 * print-ring precedent (darker shades that survive white paper). */
export declare const SEVERITY_TOKENS: Record<SeverityName, SeverityToken>;
/** The pass/secure state colour — Seclayer's SECURE token, also the brand. */
export declare const SECURE_HEX = "#22c55e";
export interface GradeToken {
    hex: string;
    printHex: string;
    word: string;
}
/** Seclayer GRADE_ACCENT, verbatim, each with its word. */
export declare const GRADE_TOKENS: Record<string, GradeToken>;
export declare function gradeToken(grade: string): GradeToken;
export declare function severityToken(sev: string): SeverityToken;
/** Truth tiers in the report's group order (Seclayer's tier order). */
export type ReportTier = "proven" | "confirmed" | "deferred" | "ruled-out";
export declare const TIER_ORDER: readonly ReportTier[];
export declare const TIER_LABEL: Record<ReportTier, string>;
export declare const TIER_DEFINITION: Record<ReportTier, string>;
/** Escape a target-derived string for HTML text/attribute positions. */
export declare function esc(s: string): string;
