import type { Harness2Paths } from "./contract.js";
import type { ProposalPackageDocument } from "./package.js";
/** Render sections 1-6 (section 7 needs their delimiter counts first). */
export declare function renderPackageSections(doc: ProposalPackageDocument): string;
/** Fill section 7 from the real rendered text (delimiter balance is measured). */
export declare function finalizePackage(doc: ProposalPackageDocument): ProposalPackageDocument;
/** Render the complete seven-section package, ready to paste or chunk. */
export declare function renderPackageDocument(doc: ProposalPackageDocument): string;
/** Backwards-compatible name for the package renderer. */
export declare const renderProposalPackage: typeof renderPackageDocument;
export interface WriteProposalPackageResult {
    readonly dir: string;
    readonly markdownPath: string;
    readonly jsonPath: string;
    readonly chunks: number;
}
/** Write runs/<timestamp>-<class>/package.md + package.json atomically. */
export declare function writeProposalPackage(paths: Harness2Paths, doc: ProposalPackageDocument): WriteProposalPackageResult;
