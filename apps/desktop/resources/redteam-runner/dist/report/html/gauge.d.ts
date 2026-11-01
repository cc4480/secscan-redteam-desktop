/**
 * Score + severity visuals: the 270° gauge (Seclayer's ScoreGauge, at
 * SecScan's cover scale), the stacked SeverityBar, and the severity count
 * chips. All colours read the token table (tokens.ts) — the bar, the chips,
 * and the cards can never disagree about what a severity looks like.
 *
 * Gauge semantics are POSTURE (higher is better, the embedded engine's
 * math) — never SecScan's inverted risk label.
 */
import { type SeverityName } from "./tokens.js";
export interface GaugeOptions {
    /** Posture score 0–100, or null for the N/A (incomplete/halted) state. */
    score: number | null;
    /** Grade letter ("A"…"F"), or "N/A". */
    grade: string;
}
/**
 * The cover gauge: recessive track, grade-coloured arc, hero score with
 * /100, caption "Grade {letter} — {word}". N/A renders "— / Incomplete" on
 * a near-empty neutral gauge: a scan that could not be graded never shows
 * a passing number.
 */
export declare function scoreGauge(o: GaugeOptions): string;
/** Stacked proportional severity bar, worst-first; an all-clear state
 * renders a green-tinted recessive track so the baseline stays consistent. */
export declare function severityBar(counts: Record<SeverityName, number>): string;
/** The at-a-glance count row: one chip per severity, count in a dark inset
 * box (SecScan's badge row, Seclayer's tokens). */
export declare function severityChips(counts: Record<SeverityName, number>): string;
/** Green used by non-token call sites (all-clear, proven accents). */
export declare const SECURE = "#22c55e";
