import type { BaselineInput, CoverageFactsInput, DetailFindingInput, DetailInput, FindingDiff, PillarCard, ReportDetail, RiskArea } from './detail.js';
/** §7 — pillar cards from the single-primary attribution. DAST's
 * ran-state includes the SecScan engine (§7.1); EASM is fed by recon
 * facts and never reads SECURE or NOT COVERED (§7.3). */
export declare function buildPillars(input: DetailInput, pillarOf: Map<string, string>): PillarCard[];
/** §3 line 4 — the coverage figures, composed once (the §6.2
 * zero-action entry reuses the same figures). */
export declare function coverageLine(c: CoverageFactsInput): string;
/** §8 — surface rows: a field renders only when the record carries
 * it; the network block is null when no row has data. */
export declare function buildSurface(input: DetailInput): Pick<ReportDetail, 'surfaceNetwork' | 'surfaceDynamic'>;
/** §3 — the deterministic breakdown lines, each included only when
 * its inputs exist, in the spec's order. */
export declare function buildBreakdown(input: DetailInput, riskAreas: RiskArea[], diff: FindingDiff | null, countsOnly: boolean): string[];
/**
 * §2 — diff the current actionable set against the baseline's.
 * Matching is two-pass: exact identity keys first, then leftover pairs
 * by normalized title alone when their refs do not conflict (one side
 * ref-less) — a baseline recorded without source labels still matches
 * its labeled current twin, while same-title findings carrying
 * different attackIds stay distinct (one new + one resolved).
 */
export declare function diffFindings(current: DetailFindingInput[], baseline: BaselineInput, currentScore?: number): FindingDiff;
