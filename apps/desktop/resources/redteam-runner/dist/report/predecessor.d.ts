import { type Ctx, type LiveFinding } from "../context.js";
import { type PocBundle } from "../proof/index.js";
import { type EngagementEvent, type Finding } from "../types.js";
import { type ArmRun, type BaselineInput, type DetailInput } from "./detail.js";
import { type ReportMeta } from "./html.js";
import { type FindingMeta } from "./html/cards.js";
/** §1.2 target normalization: lowercase scheme+host, default ports
 * stripped, a single trailing slash on an empty path stripped, non-empty
 * paths kept verbatim — a different path is a different target. */
export declare function normalizeTargetKey(raw: string): string;
/** Record this engagement's posture of record for future diffs (§1.2.7:
 * engagements written before this record existed resolve counts-only).
 * A null posture (halted / blocked end — the report issues no grade)
 * writes the record WITHOUT score/grade: deriving them would fabricate
 * an A/100 for a run that confirmed nothing (eng-2026-11-02-or12).
 * Consumers tolerate the absence (both fields optional; counts-only). */
export declare function recordReportMeta(ctx: Ctx, posture: {
    score: number;
    grade: string;
} | null): void;
/** §1.2 predecessor resolution over the sibling engagement directories. */
export declare function resolvePredecessor(ctx: Ctx): BaselineInput | undefined;
export declare function armLabelOf(vulnClass: string | undefined): string;
/** Join report findings to live findings (normalized title + attackId,
 * the verdicts discipline) so each finding carries its recorded source
 * label into the derivations. Each live finding is consumed once. */
export declare function joinLiveLabels(findings: Finding[], live: LiveFinding[]): Map<string, LiveFinding>;
/** Arm runs the event log proves: engine tool actions, plus DAST probe
 * names from the handlers' own result labels. Nothing else is claimed. */
export declare function extractArmRuns(events: EngagementEvent[]): ArmRun[];
export interface DetailAssemblyDeps {
    ctx: Ctx;
    findings: Finding[];
    bundles: ReadonlyMap<string, PocBundle>;
    findingMeta: ReadonlyMap<string, FindingMeta>;
    totals: DetailInput["coverage"]["totals"];
    cells: {
        target: string;
        category: string;
        state: string;
    }[];
    planOnly: string[];
    events: EngagementEvent[];
}
/** Assemble the DetailInput + the meta.baseline stamp for one report. */
export declare function buildDetailInput(deps: DetailAssemblyDeps): {
    input: DetailInput;
    baselineMeta?: ReportMeta["baseline"];
};
