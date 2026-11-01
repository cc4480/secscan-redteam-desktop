/**
 * Scan-integrated Foundry capture: completed engagement → live cases.
 *
 * Called from the trajectory capture point (harness2/trajectory.ts), which
 * runEngagement's finally block reaches for every outcome. For each
 * confirmed finding, a candidate case is projected to pattern fields only,
 * sanitized fail-closed, tiered, and registered in the app-data store.
 *
 * Tier rule (project rule): BRONZE by default — a single source. SILVER
 * only when two independent mechanisms agree: the dual-exploiter cell's
 * PROVEN adjudication plus at least one independent signal (the finding's
 * separate confirmation in engagement state, or a second live finding in
 * the same family recorded under a different attack id). GOLD is never
 * assigned here; it is editor-adjudicated elsewhere.
 *
 * FAILURE ISOLATION: this module never throws. Any error is returned in
 * the result (and noted by the caller) — capture can never fail, block,
 * or delay the engagement it observes.
 */
import type { Finding } from '../types.js';
import type { LiveFinding } from '../context.js';
import { type CasePattern, type FoundryTier } from './store.js';
/** The inputs capture reads from a finished engagement. */
export interface CaptureInput {
    engagementId: string;
    target: string;
    stateFindings: readonly Finding[];
    liveFindings: readonly LiveFinding[];
    /** Stack fingerprints from the engagement fingerprint (pattern-level). */
    techFingerprints: readonly string[];
    storeDir: string;
    /** Clock override for tests. */
    now?: () => Date;
    /** Disable the automatic Gold Loop enqueue (tests, operator tooling). */
    autoLoop?: boolean;
}
/** What capture did, in counts the caller can log. */
export interface CaptureResult {
    added: number;
    skippedDuplicates: number;
    dropped: number;
    dropReasons: string[];
    error: string | null;
    caseIds: string[];
}
interface Candidate {
    pattern: CasePattern;
    tier: FoundryTier;
    mechanisms: string[];
    proofType: string;
}
/** Build the candidate cases for one engagement (pure; no I/O). */
export declare function buildCandidates(input: CaptureInput): {
    candidates: Candidate[];
    drops: Array<{
        reasons: string[];
    }>;
};
/**
 * Capture an engagement's findings into the Foundry store. Never throws.
 *
 * @param input - the finished engagement's findings and store location
 * @returns counts of what was added, skipped, and dropped, plus any error
 */
export declare function captureFoundryCases(input: CaptureInput): CaptureResult;
export {};
