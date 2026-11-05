/**
 * Shared context types — extracted from context.ts to keep the context module
 * under the 300-line budget. Pure declarations plus HaltError.
 */
import { type ActorRole, type PeerReviewStamp } from "./types.js";
export interface TargetMapEntry {
    area: string;
    method: string;
    params?: string;
    authState?: string;
    attackId?: string;
    notes?: string;
}
/** A confirmed finding recorded live during exploitation (shared state). */
export interface LiveFinding {
    severity: string;
    title: string;
    vulnClass?: string;
    attackId: string;
    evidence: string;
    payload?: string;
    /**
     * Dual-exploiter cell outcome (spec §5), set only when the finding was
     * recorded with a proven claim and adjudicated by exploit-cell/live.ts:
     * 'proven' means both cell signatures plus a passing negative control;
     * anything else ends 'detected'. Absent = never adjudicated.
     */
    cellState?: 'proven' | 'detected';
    /**
     * The adjudicated claim's expected marker + target URL, retained by
     * exploit-cell/live.ts only when a claim was present at adjudication, so
     * the report layer can show what was proven. The claim's receipt is NOT
     * retained here — it lives in the audit trail.
     */
    provenClaim?: {
        expectedMarker: string;
        targetUrl: string;
    };
    /** The adjudication outcome's one-line detail, retained with the claim. */
    cellDetail?: string;
    /**
     * Engine-recorded CVSS base score (Q-RP-3), copied verbatim from the
     * producing engine's record (the SecScan scanner's cvssScore) at the
     * dispatch seam. Absent when the engine recorded none — never derived
     * from severity, never estimated.
     */
    cvss?: number;
    /** Engine-recorded CWE id (Q-RP-3), same provenance rule as cvss. */
    cwe?: string;
    /**
     * Q-FLEET-XCHECK: the fleet seat that recorded this finding, stamped
     * by the RUNNER from the dispatch role at record time (or, for the
     * exploiter's VERDICTS-block backstop, from the block's owner) — never
     * a model-supplied tool argument. The reviewer pass challenges each
     * finding with a different seat; without a recorded producer that
     * rule has nothing to bite on. Absent = recorded before the stamp.
     */
    producer?: ActorRole;
    /** Q-FLEET-XCHECK peer-review stamp (types.ts PeerReviewStamp). Stamped by the reviewer pass only. */
    peerReview?: PeerReviewStamp;
}
/** A killed hypothesis recorded live during exploitation (shared state). */
export interface KilledLive {
    hypothesis: string;
    killingObservation: string;
    vulnClass?: string;
    attackId?: string;
    payload?: string;
}
export declare class HaltError extends Error {
}
