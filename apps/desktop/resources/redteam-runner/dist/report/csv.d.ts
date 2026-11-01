import { type Ctx } from "../context.js";
import { type Finding } from "../types.js";
import { type PocBundle } from "../proof/index.js";
import { type FindingMeta } from "./html/cards.js";
export declare const FINDINGS_CSV_COLUMNS: readonly ["id", "title", "severity", "cvss", "cwe", "target", "status", "proof_state", "remediation_summary"];
export interface FindingsCsvInput {
    findings: readonly Finding[];
    findingMeta: ReadonlyMap<string, FindingMeta>;
    bundles: ReadonlyMap<string, PocBundle>;
    /** The engagement target (host or URL) every row belongs to. */
    target: string;
}
/** The full sheet: header + one row per finding, CRLF line endings. */
export declare function buildFindingsCsv(input: FindingsCsvInput): string;
/** Write findings.csv beside report.md/report.html. Its own failure
 * domain, mirroring the HTML twin: a CSV problem is recorded as an event,
 * never a lost report. */
export declare function emitFindingsCsv(ctx: Ctx, findings: Finding[], bundles: ReadonlyMap<string, PocBundle>): void;
