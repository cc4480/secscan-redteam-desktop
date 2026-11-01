import { type Ctx, type LiveFinding } from "../context.js";
import { type Finding } from "../types.js";
import { type PocBundle } from "../proof/index.js";
import { type EngagementReportInput } from "./html/render.js";
import { type ReportModelArgs } from "./deliverables.js";
import { type ReportDocument } from "./document.js";
import { type ReportMarkdownAnnexes } from "./markdown.js";
/** Q-RP-3: engine-recorded CVSS/CWE join the final findings mechanically
 * (corroborated live-finding match; unproven values are removed). */
export declare function stampFindingRefs(findings: Finding[], liveFindings: readonly LiveFinding[]): void;
/** Q-RP-1: the findings sheet of the deliverable package, from the same
 * model the HTML renders (own try/catch inside — never breaks the report). */
export declare function emitFindingsSheet(ctx: Ctx, findings: Finding[], bundles: ReadonlyMap<string, PocBundle>): void;
/** Q-DELIVERABLES-AUTOFIRE (G7): report.md's write, guarded into the
 * deliverable failure domain. It used to be the one unguarded write in
 * the phase: a failure escaped reportPhase and was misrecorded as a
 * halt. Now it is an event (`report_md_failed`), the remaining
 * deliverables still emit from the in-memory model, and the close-out
 * verification records the gap as deliverable_failed. */
export declare function writeReportMd(ctx: Ctx, reportMd: string): void;
/** The markdown + CSV source the phase hands over: the legacy
 * assembled report.md (the fallback), the final findings + bundles
 * (the CSV fallback order), and the runner-computed annexes the
 * document renderer places in their canonical slots. */
export interface ReportMdSource {
    legacyMd: string;
    findings: Finding[];
    bundles: ReadonlyMap<string, PocBundle>;
    annexes: ReportMarkdownAnnexes;
}
/** Q-REPORT-TEMPLATES: report.md and findings.csv render from the ONE
 * report document when it built — the markdown mirrors the flagship's
 * anatomy and the CSV rows follow report order, as its header comment
 * has always claimed. When the document could not be built (the HTML
 * input assembly failed), the legacy assembly and the recorded order
 * stand, exactly as before the unification. Each write keeps its own
 * failure domain (writeReportMd / emitFindingsCsv guard themselves). */
export declare function emitMarkdownAndCsv(ctx: Ctx, doc: ReportDocument | undefined, src: ReportMdSource): void;
/** Q-RP-2 + Q-RP-5 + Q-DELIVERABLES-AUTOFIRE: the closing deliverables,
 * in order — report.md + findings.csv from the one report document,
 * the DOCX copy from the same assembled input as the HTML (own
 * try/catch inside), the report model twins (report.json + report.txt,
 * built from the phase's final records so they emit even when the HTML
 * input assembly failed), then the package zip over the artifacts on
 * disk. The package reads the emitted files back, so it runs even when
 * a writer failed; it then fails loudly on the missing deliverable
 * (report_package_failed) instead of shipping a partial set. */
export declare function emitDeliverables(ctx: Ctx, reportInput: EngagementReportInput | undefined, modelArgs: ReportModelArgs, mdSource?: ReportMdSource): void;
