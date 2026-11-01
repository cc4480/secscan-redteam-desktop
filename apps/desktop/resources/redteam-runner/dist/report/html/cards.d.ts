/**
 * Finding cards and proof blocks (design study D6/D7).
 *
 * Tier discipline is the honesty core of the design: the PROVEN badge is
 * keyed to a PoC bundle whose validationTier is "execution" (the runner's
 * replayable, marker-backed proof) or to the exploit-cell's adjudicated
 * verdict carried on the finding (Q-PROVEN) — never to a severity, a
 * confidence word, or the scoring seam. A confirmed finding with no bundle says so,
 * with the reason the runner computed. Nothing is derived or guessed:
 * reference chips render only from fields the record actually carries.
 */
import { type Finding } from "../../types.js";
import { type PocBundle, type NegativeProof } from "../../proof/index.js";
import { type ReportTier } from "./tokens.js";
/** Optional per-finding reference data, present only where a real record
 * carries it (battery item resolution in the report phase, or a bundle). */
export interface FindingMeta {
    category?: string;
    owasp?: string;
    cwe?: string;
    cvss?: number;
}
/** The truth tier a finding renders under. PROVEN requires a runner
 * stamp: an execution-tier bundle, or the cell's adjudicated verdict. */
export declare function tierOf(f: Finding, bundle?: PocBundle): ReportTier;
/** The severity chip, shared with the detail sections (area/pillar rows). */
export declare function severityChip(sev: string): string;
/** The evidence receipt (D7): heading by validation tier, what it proves,
 * the marker line, the ordered redacted steps, what it does NOT prove,
 * and the reverify command. Observation receipts are never badged proven. */
export declare function proofBlock(bundle: PocBundle): string;
/** The Cell Receipt (Q-PROVEN): the proof block for a cell-proven finding
 * with no execution bundle to show. The verdict is the runner's cell stamp
 * (challenger critique + verification signatures + a passing negative
 * control); the block shows the record the adjudication retained — the
 * expected marker, the target it was observed at, and the adjudication
 * detail line. Every interpolated value passes through esc(): the marker
 * is agent-chosen free text, never injected raw. */
export declare function cellReceiptBlock(f: Finding): string;
export interface CardInput {
    finding: Finding;
    bundle?: PocBundle;
    /** Runner-computed reason a confirmed finding has no bundle. */
    noBundleReason?: string;
    meta?: FindingMeta;
    /** Q-RP-4 — the mechanically derived per-finding Impact statement
     * (report/detail-impact.ts), present only for findings of record. */
    impact?: string;
}
/** One finding card (D6): chip row, evidence body, proof block or the
 * honest no-bundle line, remediation fix + retest, accountability footer. */
export declare function findingCard(o: CardInput): string;
/** A ruled-out hypothesis rendered from its negative proof: the decisive
 * observation is the content — negative proof is presented, never deleted. */
export declare function negativeProofCard(n: NegativeProof): string;
/** Severity rank for in-tier sorting (critical first); unknown → last. */
export declare function severityRank(sev: string): number;
