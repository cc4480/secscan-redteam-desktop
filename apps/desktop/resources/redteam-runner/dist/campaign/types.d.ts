/**
 * Campaign types (Q-CAMPAIGN, scoping N1).
 *
 * A campaign sits ABOVE engagements: one wave = one engagement launched
 * with the campaign's accumulated state as its starting context. The
 * campaign record is the persistent entity that outlives any single run —
 * it binds the ONE verified scope every wave inherits, the campaign caps,
 * the wave history, and every operator decision (receipts, not prose).
 *
 * Knowledge (findings, lessons, recall) is NOT stored here — that is
 * Q-MEMTIER's substrate. This record stores plan, sequence, and intent
 * only: what waves exist, what each one did, and who approved what.
 *
 * Schema agreed in the pair build log before either half built on it
 * (campaign-build-log-2026-10-31.md). Validation lives in schema.ts;
 * persistence in store.ts; the operator-decision gate in gate.ts.
 */
import type { Finding } from '../types.js';
/** Campaign lifecycle (scoping N5): draft → armed → wave-running →
 *  awaiting-advance → complete/stopped, with paused as an operator hold. */
export type CampaignStatus = 'draft' | 'armed' | 'wave-running' | 'awaiting-advance' | 'paused' | 'complete' | 'stopped';
/** Wave lifecycle. "interrupted" is set ONLY by resume-repair (store.ts)
 *  when a process restart strands a running wave — never by a normal
 *  harvest, and never silently upgraded to "complete". */
export type WaveStatus = 'planned' | 'running' | 'complete' | 'halted' | 'interrupted' | 'failed';
/** Finding severity, bound to the runner's own Finding shape. */
export type WaveSeverity = Finding['severity'];
/** Campaign-level caps, fixed at creation (scoping §1.1). */
export interface CampaignCaps {
    /** Hard ceiling on waves, enforced by the gate in every launch path. */
    maxWaves: number;
    /** Optional campaign budget ceiling (opaque units, kind-defined). */
    maxBudget?: number;
}
/**
 * Auto-advance state (Decision C-1). The DEFAULT is operator-gated:
 * `enabled` is false at creation and may only become true through a
 * recorded "enable-auto-advance" operator decision whose seq this state
 * points back to. An enabled flag without a resolvable enabling decision
 * authorizes nothing (gate.ts enforces the resolution).
 */
export interface AutoAdvanceState {
    enabled: boolean;
    /** Recorded wave cap from the enabling decision. */
    maxWave?: number;
    /** Who recorded the enabling decision. */
    enabledBy?: string;
    /** When the enabling decision was recorded (ISO). */
    enabledAt?: string;
    /** Seq of the enabling OperatorDecision in this record's decisions[]. */
    decisionSeq?: number;
}
export type OperatorDecisionKind = 'start' | 'advance' | 'enable-auto-advance' | 'disable-auto-advance' | 'pause' | 'resume' | 'stop' | 'complete';
/**
 * A recorded operator decision — the receipt the wave gate consults.
 * Every launch authorization traces to one of these (who/what/when),
 * either directly (start/advance) or via the auto-advance state an
 * enable-auto-advance decision created. There is no other path: a wave
 * never advances on an agent's say-so (scoping §6, "explicitly never").
 */
export interface OperatorDecision {
    /** Per-campaign monotonic sequence, starting at 0. */
    seq: number;
    /** ISO timestamp of the decision. */
    ts: string;
    /** Named human operator. Non-empty — enforced at record time. */
    operator: string;
    kind: OperatorDecisionKind;
    /** "advance": the 1-based wave this decision authorizes. */
    waveIndex?: number;
    /** "enable-auto-advance": the recorded wave cap for auto-advance. */
    maxWave?: number;
    note?: string;
}
/** Mechanical per-wave rollup, computed from an EngagementResult's
 *  findings at harvest time (store.ts) — never hand-entered. */
export interface WaveRollup {
    totalFindings: number;
    confirmed: number;
    killed: number;
    deferred: number;
    bySeverity: Record<WaveSeverity, number>;
}
/** The harvested outcome of a finished wave's engagement. */
export interface WaveOutcome {
    /** EngagementResult.status verbatim for a harvested outcome
     *  (complete | blocked | halted); the literal "error" when the
     *  engagement call threw before a result existed (settleFailedWave),
     *  with the thrown message in blockedReason. */
    engagementStatus: string;
    blockedReason?: string;
    reportPath?: string;
    rollup: WaveRollup;
}
export interface WaveRecord {
    /** 1-based wave number within the campaign. */
    index: number;
    status: WaveStatus;
    /** The planner's aim for this wave (written by the wave planner). */
    aim?: string;
    /** Reference to the wave plan artifact (e.g. wave-<n>/plan). */
    planRef?: string;
    /** Engagement launched for this wave, set at launch. */
    engagementId?: string;
    launchedAt?: string;
    finishedAt?: string;
    /** Set at harvest, once the engagement reaches a terminal status. */
    outcome?: WaveOutcome;
    /** Set ONLY by resume-repair when a restart strands this wave. */
    interruptedAt?: string;
    /** Why the wave was interrupted, e.g. "process-restart". */
    interruptReason?: string;
}
/** One recorded status transition — the campaign's audit spine. Every
 *  status change goes through a transition entry (receipts, not prose). */
export interface TransitionEntry {
    seq: number;
    ts: string;
    from: CampaignStatus | null;
    to: CampaignStatus;
    reason: string;
    waveIndex?: number;
}
/** The verified scope every wave inherits. One campaign = one verified
 *  scope in v1; waves never re-derive or widen it (scoping §1.1, §6). */
export interface CampaignScope {
    /** Exact hosts, non-empty. */
    hosts: string[];
    /** Reference to the ownership-verification proof for this scope. */
    verificationRef: string;
    /** Optional reference to the governing ROE document. */
    roeRef?: string;
}
export interface CampaignRecord {
    version: 1;
    /** Safe slug; also the campaign's directory name. */
    id: string;
    name: string;
    /** CampaignKind name from the kind registry. NEVER "ad" — the donor's
     *  AD kind is forbidden by the canonical manifest, Part C (schema.ts
     *  enforces this at the file boundary as well). */
    kind: string;
    status: CampaignStatus;
    scope: CampaignScope;
    objective: string;
    caps: CampaignCaps;
    autoAdvance: AutoAdvanceState;
    waves: WaveRecord[];
    decisions: OperatorDecision[];
    transitions: TransitionEntry[];
    createdAt: string;
    /** Named operator who created the campaign. */
    createdBy: string;
    updatedAt: string;
}
