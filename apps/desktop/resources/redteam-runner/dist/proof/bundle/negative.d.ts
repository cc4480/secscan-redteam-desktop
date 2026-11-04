/**
 * Negative proof (killed hypotheses with decisive audit evidence) and the
 * one-line bundle summary for the report.
 */
import type { PocBundle } from './bundle.js';
import type { EngagementEvent } from '../../types.js';
export interface NegativeProof {
    hypothesis: string;
    killingObservation: string;
    attackId?: string;
    vulnClass?: string;
    /** The audit events constituting the decisive observation (what was tried, what was seen). */
    decisiveEvents: Array<{
        seq: number;
        ts: string;
        tool: string;
        result: string;
    }>;
}
/**
 * Negative proof: for each killed hypothesis, attach the decisive audit
 * events. Buyers value knowing what was tried and ruled out — and the
 * registry already records the killing observation; this grounds it in
 * the actual probe sequence.
 */
export declare function buildNegativeProof(killed: Array<{
    hypothesis: string;
    killingObservation: string;
    attackId?: string;
    vulnClass?: string;
}>, events: EngagementEvent[], secrets: string[]): NegativeProof[];
/** One-line bundle summary for the report's Proof of exploitation section. */
export declare function bundleSummary(b: PocBundle): string;
