/**
 * Wiring between the report phase and the unified HTML renderer.
 *
 * The phase already computes every object the design needs (posture,
 * bundles, coverage cells, the item ledger, the event projections) — this
 * module shapes them into the renderer's structured input so phase.ts
 * stays a thin call site. Nothing here invents data: a field the records
 * do not carry stays absent and the design degrades around it.
 */
import { type Ctx, type LiveFinding } from '../../context.js';
import { type EngagementEvent, type Finding } from '../../types.js';
import { type NegativeProof, type PocBundle } from '../../proof/index.js';
import { type DetailInput } from '../detail.js';
import { type ReportMeta } from '../html.js';
import { type CoverageInput, type EngagementReportInput, type FindingMeta } from './render.js';
import { type TeamMember } from './sections.js';
/** Structured proof data the proof section computes alongside its
 * markdown (no-bundle reasons per finding + negative proofs). */
export interface ProofData {
    noBundleReasons: Map<string, string>;
    negative: NegativeProof[];
}
export interface WireDeps {
    ctx: Ctx;
    meta: ReportMeta;
    title: string;
    findings: Finding[];
    /** The reporter narrative BEFORE runner-computed sections are appended. */
    narrativeMd: string;
    bundles: ReadonlyMap<string, PocBundle>;
    proof: ProofData;
    /** Full-battery cell states ({target, category, state}); empty when the
     * engagement was not full-battery — cells are then derived from the
     * scoped coverage set. */
    cells: CoverageInput['cells'];
    totals: CoverageInput['totals'];
    planOnly: string[];
    events: EngagementEvent[];
    haltedReason?: string;
    blockedReason?: string;
    /** The assembled detail derivations input (report/predecessor.ts),
     * when the phase could build one; absent => pre-detail anatomy. */
    detailInput?: DetailInput;
}
/**
 * Remove the reporter's trailing findings JSON block from the narrative.
 * The block is machine data — the findings render as cards — and leaving
 * it in the executive summary would print raw JSON as prose. Only a
 * fenced block that parses to an object with a findings array is cut;
 * anything else is the reporter's prose and stays untouched.
 */
export declare function stripFindingsJson(md: string): string;
/** Q-RP-3 report-phase join: stamp each final finding's engine-recorded
 * CVSS/CWE from its source live finding. Matching is corroborated, never
 * positional-only: the positional candidate (the halted path's map and
 * the reporter's list both preserve live order) must agree on attackId or
 * title; failing that, a unique attackId+title match across the live set
 * wins. Ambiguous or unmatched ⇒ the fields are REMOVED, so a value the
 * reporter JSON invented cannot survive into the report. */
export declare function applyFindingRefs(findings: Finding[], liveFindings: readonly LiveFinding[]): void;
/** Per-finding reference data from the PoC bundle's battery item: the
 * item's battery category and OWASP reference are recorded data (the
 * battery definitions carry both), resolved through the same profile the
 * proof section attributed the bundle to. Findings without a bundle have
 * no recorded category — the map simply has no entry for them. Q-RP-3:
 * engine-recorded CVSS/CWE stamped onto the final findings by
 * applyFindingRefs merge into the same map, so the reference chips and
 * findings.csv read one model. */
export declare function buildFindingMeta(bundles: ReadonlyMap<string, PocBundle>, findings?: readonly Finding[]): Map<string, FindingMeta>;
/** The fleet roster as the report's team section states it: every
 * seat, its role on the engagement. Summaries stay with the record —
 * the wire carries the standing roles only. */
export declare const FLEET_TEAM: TeamMember[];
/** Assemble the renderer's structured input from the phase's records. */
export declare function buildEngagementReportInput(deps: WireDeps): EngagementReportInput;
