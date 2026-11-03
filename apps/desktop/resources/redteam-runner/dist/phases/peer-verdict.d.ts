/**
 * Peer-review verdict primitives — extracted from peer-review.ts to keep the
 * phase module under the 300-line budget.
 *
 * These are pure: seat selection and the checker's answer parser. Nothing here
 * touches the model or the engagement state, so they extract without changing
 * the phase's behaviour.
 */
import type { AgentRole } from '@secscan/redteam-llm-router';
import { type ActorRole, type PeerReviewStamp } from '../types.js';
/** Checker preference: the Architect owns review; then the coordinator
 * (the sign-off seat), reporter, recon, exploiter. The producer is
 * removed from the list before picking — see selectChecker. */
export declare const CHECKER_PREFERENCE: readonly AgentRole[];
/**
 * The checker for a finding: the first preferred seat that is NOT the
 * producer. Pure and total — for every producer (including 'runner'
 * and an absent stamp) some other seat is returned, so the pass can
 * never seat a finding's producer as its own checker.
 */
export declare function selectChecker(producer: ActorRole | undefined): AgentRole;
export declare const SEVERITY_LADDER: readonly ["info", "low", "medium", "high", "critical"];
export declare function coerceSeverity(s: string): (typeof SEVERITY_LADDER)[number];
export declare function oneNotchDown(sev: string): string | null;
export type PeerVerdict = PeerReviewStamp['verdict'];
export interface ParsedPeerVerdict {
    verdict: PeerVerdict;
    /** Proposed lower severity, only meaningful for 'downgraded'. */
    severity?: string;
    rationale: string;
}
/** Parse the checker's answer. Anything off-shape is null — the caller
 * records a failed challenge, never a guessed verdict. */
export declare function parsePeerVerdict(text: string): ParsedPeerVerdict | null;
