export { diffFindings } from './detail-blocks.js';
export type DetailTier = 'proven' | 'confirmed' | 'deferred';
export type DetailSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export interface DetailFindingInput {
    id: string;
    title: string;
    severity: DetailSeverity;
    tier: DetailTier;
    attackIds: string[];
    sourceLabel: string;
    signals: string[];
    fix: string;
}
export interface BaselineInput {
    engagementId: string;
    startedAt: string;
    dryRun: boolean;
    score?: number;
    grade?: string;
    findings: DetailFindingInput[];
}
export interface ArmRun {
    name: string;
    state: 'ran' | 'blocked' | 'not-covered';
    reason?: string;
}
export interface CoverageFactsInput {
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
    fullBattery: boolean;
    notCovered: string[];
    planOnly: string[];
    arms: ArmRun[];
    pathProbes?: {
        executed: number;
        confirmedAmong: number;
    };
    pagesDiscovered?: number;
    endpointsDiscovered?: number;
}
export interface SurfaceFactsInput {
    ips?: string[];
    nameservers?: string[];
    tlsGrade?: string;
    tlsDetail?: string;
    servedVia?: string;
    technologies?: string[];
    serverHeaders?: string[];
}
export interface DetailInput {
    target: string;
    mode: string;
    dryRun: boolean;
    posture: {
        score: number;
        grade: string;
        postureRating: string;
    };
    worstConfirmed?: {
        id: string;
        severity: DetailSeverity;
        title: string;
    } | null;
    findingsBySeverity: Record<DetailSeverity, number>;
    tierCounts: {
        proven: number;
        confirmed: number;
        deferred: number;
    };
    findings: DetailFindingInput[];
    baseline?: BaselineInput;
    coverage: CoverageFactsInput;
    surface: SurfaceFactsInput;
}
export interface DiffEntry {
    id?: string;
    title: string;
    severity: DetailSeverity;
    note?: string;
    fromSeverity?: DetailSeverity;
    fromTier?: DetailTier;
    toTier?: DetailTier;
}
export interface FindingDiff {
    newFindings: DiffEntry[];
    resolved: DiffEntry[];
    worsened: DiffEntry[];
    improved: DiffEntry[];
    unchangedCount: number;
    scoreDelta?: number;
    findingsDelta: number;
}
export interface RiskArea {
    name: string;
    worst: DetailSeverity;
    findings: {
        id: string;
        title: string;
        severity: DetailSeverity;
    }[];
}
export interface PriorityEntry {
    id: string;
    title: string;
    severity: DetailSeverity;
    tier: DetailTier;
    fixSentence: string;
}
export interface PillarCard {
    pillar: string;
    scopeLabel: string;
    status: 'NO ARM' | 'NOT COVERED' | 'FINDINGS' | 'SECURE' | 'MAPPED' | 'NO DATA';
    reason?: string;
    findingCount: number;
    bySeverity: Record<DetailSeverity, number>;
    footnote?: string;
}
export interface ReportDetail {
    breakdown: string[];
    diff: FindingDiff | null;
    countsOnly: boolean;
    baselineLabel?: string;
    riskAreas: RiskArea[];
    deferredCount: number;
    impact: {
        level: 'critical' | 'high' | 'medium' | 'low' | 'none';
        text: string;
    };
    /** Q-RP-4 — the per-finding Impact statements (detail-impact.ts),
     * keyed by finding id; findings of record only (PROVEN + CONFIRMED). */
    findingImpacts: Record<string, string>;
    priority: {
        actions: PriorityEntry[];
        verifyNext: PriorityEntry[];
        zeroNote?: string;
    };
    pillars: PillarCard[];
    surfaceNetwork: {
        label: string;
        value: string;
    }[] | null;
    surfaceDynamic: {
        label: string;
        value: string;
    }[];
    actionableCount: number;
}
/** The finding's own fix, truncated at its first sentence boundary. */
export declare function firstSentence(text: string): string;
/** Assemble every detail derivation for one report. */
export declare function buildReportDetail(input: DetailInput): ReportDetail;
