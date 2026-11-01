import { PocBundle, type NegativeProof } from '../proof/index.js';
import { type Finding } from '../types.js';
import { type Ctx } from '../context.js';
/** The proof section's output: the markdown for report.md plus the
 * structured records the HTML renderer consumes (the per-finding
 * no-bundle reasons and the negative proofs), so both surfaces state
 * the same facts from the same computation. */
export interface ProofSectionResult {
    markdown: string;
    noBundleReasons: Map<string, string>;
    negative: NegativeProof[];
}
export declare function buildProofSection(ctx: Ctx, findings: Finding[], pocBundleMap: Map<string, PocBundle>): ProofSectionResult;
