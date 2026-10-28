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
export const SEVERITY_ORDER: readonly SeverityName[] = ["critical", "high", "medium", "low", "info"];

export interface SeverityToken {
  hex: string;
  /** Darker print variant (print stylesheet swaps the CSS var to this). */
  printHex: string;
  label: string;
}

/** Seclayer SEVERITY_TOKENS, verbatim hexes; print variants per SecScan's
 * print-ring precedent (darker shades that survive white paper). */
export const SEVERITY_TOKENS: Record<SeverityName, SeverityToken> = {
  critical: { hex: "#f87171", printHex: "#dc2626", label: "Critical" },
  high: { hex: "#fb7185", printHex: "#e11d48", label: "High" },
  medium: { hex: "#fbbf24", printHex: "#ca8a04", label: "Medium" },
  low: { hex: "#60a5fa", printHex: "#2563eb", label: "Low" },
  info: { hex: "#a1a1aa", printHex: "#52525b", label: "Info" },
};

/** The pass/secure state colour — Seclayer's SECURE token, also the brand. */
export const SECURE_HEX = "#22c55e";

export interface GradeToken {
  hex: string;
  printHex: string;
  word: string;
}

/** Seclayer GRADE_ACCENT, verbatim, each with its word. */
export const GRADE_TOKENS: Record<string, GradeToken> = {
  A: { hex: "#22c55e", printHex: "#059669", word: "Excellent" },
  B: { hex: "#84cc16", printHex: "#16a34a", word: "Good" },
  C: { hex: "#fbbf24", printHex: "#ca8a04", word: "Fair" },
  D: { hex: "#fb923c", printHex: "#ea580c", word: "Poor" },
  F: { hex: "#ef4444", printHex: "#dc2626", word: "Critical" },
  "N/A": { hex: "#94a3b8", printHex: "#64748b", word: "Incomplete" },
};

export function gradeToken(grade: string): GradeToken {
  return GRADE_TOKENS[grade] ?? GRADE_TOKENS["N/A"]!;
}

export function severityToken(sev: string): SeverityToken {
  return SEVERITY_TOKENS[(sev as SeverityName)] ?? SEVERITY_TOKENS.info;
}

/** Truth tiers in the report's group order (Seclayer's tier order). */
export type ReportTier = "proven" | "confirmed" | "deferred" | "ruled-out";

export const TIER_ORDER: readonly ReportTier[] = ["proven", "confirmed", "deferred", "ruled-out"];

export const TIER_LABEL: Record<ReportTier, string> = {
  proven: "Proven",
  confirmed: "Confirmed",
  deferred: "Deferred",
  "ruled-out": "Ruled out",
};

export const TIER_DEFINITION: Record<ReportTier, string> = {
  proven: "Exploitation demonstrated end-to-end; a replayable proof bundle backs each finding.",
  confirmed: "Validated by the engagement's confirmation discipline; no replayable bundle was produced.",
  deferred: "Not resolved this engagement — carried forward with its reason, not silently dropped.",
  "ruled-out": "Tested and excluded: the decisive observation is recorded as negative proof.",
};

/** Escape a target-derived string for HTML text/attribute positions. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
