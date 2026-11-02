/**
 * Report sections (design study D5, in order): cover, posture banner,
 * coverage strip, complete fix prompt, tool activity, audit footer.
 * The executive-summary and findings sections are assembled by render.ts
 * (they own the prose renderer and the tier grouping respectively).
 */
import { type SecurityPosture, type PostureBanner } from '#seclayer/server/scoring.js';
import { type Finding } from '../../types.js';
import { type PocBundle } from '../../proof/index.js';
import { type ReportMeta } from '../html.js';
import { type ReportTier } from './tokens.js';
export interface CoverInput {
    meta: ReportMeta;
    posture: SecurityPosture;
    tierCounts: Record<ReportTier, number>;
    haltedReason?: string;
    blockedReason?: string;
    dryRun?: boolean;
    /** Baseline deltas (detail.ts outputs), present only when a same-engine
     * baseline with a recorded score exists — never a fabricated Δ 0. */
    delta?: {
        scoreDelta?: number;
        findingsDelta: number;
        baselineLabel: string;
    };
}
/** Section 1 — the cover: SecScan's composition (target + summary meta on
 * the left, the score block on the right) in Seclayer's tokens. A halted
 * engagement renders the N/A gauge and states why it halted. */
export declare function coverSection(o: CoverInput): string;
/** The SecScan RedTeam brand mark (the app icon's diamond and
 * crosshair), inlined so the standalone report file carries the brand
 * with no external asset. Artwork: apps/desktop/resources/icon.svg. */
export declare const BRAND_MARK_SVG: string;
/** One fleet seat's line on the report's team section. `summary` is
 * the seat's contribution to this engagement; absent renders the
 * role alone. */
export interface TeamMember {
    agent: string;
    seat: string;
    role: string;
    summary?: string;
}
/** The engagement team: every fleet seat that ran, its role, and its
 * contribution — rendered after the posture banner. */
export declare function teamSection(team: TeamMember[]): string;
/** The halt banner: why the engagement stopped, in place of a grade. */
export declare function haltBanner(reason: string): string;
/** The blocked banner: authorization denied before any testing ran —
 * the block is the headline and no grade is issued (Q-DELIVERABLES-AUTOFIRE P3). */
export declare function blockedBanner(reason: string): string;
/** Section 2 — the posture banner: severity-proportioned, worst finding
 * named (the grading seam's bannerForPosture output, verbatim). */
export declare function bannerSection(banner: PostureBanner): string;
export type CoverageCellState = 'done' | 'blocked' | 'missing';
export interface CoverageCell {
    target: string;
    category: string;
    state: CoverageCellState;
}
export interface CoverageInput {
    fullBattery: boolean;
    cells: CoverageCell[];
    totals: {
        total: number;
        confirmed: number;
        executedClean: number;
        killed: number;
        blocked: number;
        na: number;
        pending: number;
    };
    probesUsed: number;
    /** Items that execute only when a prerequisite is supplied. */
    planOnly: string[];
    /** Human labels for cells/categories not covered. */
    notCovered: string[];
}
/** Section 4 — the coverage strip: what was actually checked, cell by
 * cell, with the honest limits named. This is what makes a zero-finding
 * report credible. */
export declare function coverageSection(c: CoverageInput): string;
/** The consolidated fix prompt text (Seclayer's Complete Fix Prompt
 * pattern): role framing once, then every actionable finding as a compact
 * section. Composed mechanically from the finding records — never by an
 * agent — so the prompt and the report can never drift apart. */
export declare function buildFixPrompt(target: string, findings: Finding[], bundles: ReadonlyMap<string, PocBundle>): string;
/** Section 7 — the fix prompt panel: scrollable on screen, full in print. */
export declare function fixPromptSection(target: string, findings: Finding[], bundles: ReadonlyMap<string, PocBundle>): string;
export interface ActivityRow {
    action: string;
    count: number;
    attackIds: string[];
    firstSeq: number;
    lastSeq: number;
}
export interface ActivityInput {
    eventCount: number;
    rows: ActivityRow[];
    totalActions: number;
    decisions: {
        action: string;
        seq: number;
    }[];
    danglingCauses: number[];
}
/** Section 8 — tool activity + operator decisions + causality integrity,
 * projected from the audit log; the record, not a narrative about it. */
export declare function activitySection(a: ActivityInput): string;
/** The all-clear panel (Seclayer's pattern): a clean result is stated as
 * a result, with the coverage section above as its evidence. */
export declare function allClearSection(): string;
/** Section 9 — artifacts & audit footer: the machine-readable records
 * alongside this file are authoritative for every figure shown. */
export declare function footerSection(meta: ReportMeta): string;
