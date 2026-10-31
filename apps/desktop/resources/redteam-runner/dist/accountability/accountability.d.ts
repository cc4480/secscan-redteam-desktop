/**
 * Named accountability + approval log (v0.17.0) — the human side of the
 * autonomy tiers.
 *
 * Buyers reject AI-only testing without a named human accountable per
 * finding. This module provides:
 *
 *  - `requireNamedOperator`: production engagements refuse to start without
 *    a named human operator (fail fast, before any packet). Staging warns
 *    via the existing "(operator name not supplied)" fallback.
 *  - `ApprovalLog`: every approval (tier declared, tier escalation,
 *    production confirmation, scope renewal) appended to an
 *    append-only-per-engagement log (approvals.jsonl), with who/what/when.
 *    The log is embedded in the compliance pack and the safety manifest.
 *  - `escalateTier`: the ONLY path to change the tier mid-engagement. Raising
 *    it requires an operator name + reason; lowering it is allowed freely but
 *    still logged. The approval is recorded FIRST, then the tier moves. There
 *    is no agent tool that calls this — a tier change is an operator act,
 *    never a silent agent decision.
 *
 * Honesty: tiers describe what the agents MAY do, never imply the human did
 * the work. The accountability record adds who supervised and approved.
 */
import type { AutonomyTier } from "./tiers.js";
export type ApprovalKind = "tier-declared" | "tier-escalation" | "tier-de-escalation" | "production-confirm" | "scope-renewal";
export interface ApprovalEntry {
    seq: number;
    ts: string;
    engagementId: string;
    operator: string;
    kind: ApprovalKind;
    detail: string;
    fromTier?: AutonomyTier;
    toTier?: AutonomyTier;
}
export declare const OPERATOR_ENV = "REDTEAM_OPERATOR";
/** Resolve the named human operator: explicit input wins, then env. */
export declare function resolveOperatorName(inputName: string | undefined, env?: NodeJS.ProcessEnv): string | undefined;
/**
 * Mechanical: production engagements refuse to start without a named human
 * operator. Someone must be accountable. Staging keeps the existing
 * fallback labeling (honest "(not supplied)" marker downstream).
 */
export declare function requireNamedOperator(environment: "staging" | "production", operator: string | undefined): void;
export interface EscalationApproval {
    operator: string;
    /** Required when raising the tier; optional when lowering it. */
    reason?: string;
}
/**
 * Append-only approval log, one file per engagement (approvals.jsonl).
 * Entries are never edited or deleted — the log is the record.
 */
export declare class ApprovalLog {
    private seq;
    private readonly file;
    private readonly engagementId;
    constructor(dir: string, engagementId: string);
    append(kind: ApprovalKind, operator: string, detail: string, fromTier?: AutonomyTier, toTier?: AutonomyTier): ApprovalEntry;
    list(): ApprovalEntry[];
    get path(): string;
}
/**
 * The ONLY path to change the tier mid-engagement. Raising the tier requires
 * a named operator and a reason; the approval is recorded BEFORE the tier
 * moves. Lowering the tier mid-run is harmless (it only shrinks what agents
 * may do), so it is allowed freely — but it is still logged with the
 * operator's name. There is no agent tool that calls this — a tier change is
 * an operator act, never a silent agent decision.
 *
 * Returns the recorded approval entry. Refuses no-op moves.
 */
export declare function escalateTier(state: {
    current: AutonomyTier;
}, toTier: AutonomyTier, log: ApprovalLog, approval: EscalationApproval): ApprovalEntry;
