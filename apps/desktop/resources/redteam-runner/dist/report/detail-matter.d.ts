export interface MatterTotals {
    total: number;
    confirmed: number;
    executedClean: number;
    killed: number;
    blocked: number;
    na: number;
    pending: number;
}
export interface MatterInput {
    target: string;
    objective: string;
    mode: string;
    tier: number;
    environment: string;
    localHost: boolean;
    dryRun: boolean;
    /** Rules of engagement, verbatim from the engagement input. */
    scope: string[];
    outOfScope: string[];
    excludedTechniques: string[];
    stopConditions: string[];
    testWindow?: {
        start: string;
        end: string;
    };
    deconflictionContact?: string;
    /** Authorisation record: the cover's verified flag plus the runner's
     * recorded proof (ctx.verifiedAt / ctx.verificationProof). */
    verified: boolean;
    verifiedAt?: string;
    verificationProof?: string;
    operator?: string;
    client?: string;
    startedAt: string;
    generatedAt: string;
    /** Method facts: battery composition, plan phases, recorded activity. */
    fullBattery: boolean;
    batteryTargets: {
        id: string;
        items: number;
    }[];
    categoriesProbed: string[];
    planPhases: string[];
    probesUsed: number;
    toolActions: number;
    eventCount: number;
    /** Limitations facts, from the coverage record. */
    totals: MatterTotals;
    notCovered: string[];
    planOnly: string[];
    blockedCells: string[];
    haltedReason?: string;
    /** Strengths facts (Q-RP-8): the ledger's executed-clean count, the
     * same items grouped by (target, category), and the ruled-out
     * hypotheses (negative proofs + killed findings, de-duplicated). */
    executedClean: number;
    cleanAreas: {
        target: string;
        category: string;
        items: number;
    }[];
    ruledOut: string[];
}
export interface MatterRow {
    label: string;
    value: string;
}
export interface ReportMatter {
    scopeRows: MatterRow[];
    authorisationRows: MatterRow[];
    methodLines: string[];
    riskMethodLines: string[];
    limitationLines: string[];
    /** Q-RP-8 — present only when the record carries strength evidence. */
    strengths?: {
        summary: string;
        areaLines: string[];
    };
}
/** Assemble every front/back-matter derivation for one report. */
export declare function buildReportMatter(input: MatterInput): ReportMatter;
