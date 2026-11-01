/**
 * Report-phase hooks extracted from report/phase.ts so the orchestrator
 * stays inside the 300-line file budget. Each hook is one call into the
 * module that owns the behavior (html/wire.ts for the refs stamp,
 * csv.ts for the findings sheet); this file only gives phase.ts its
 * call sites.
 */
import { type Ctx, type LiveFinding } from "../context.js";
import { type Finding } from "../types.js";
import { type PocBundle } from "../proof/index.js";
import { applyFindingRefs } from "./html/wire.js";
import { emitFindingsCsv } from "./csv.js";

/** Q-RP-3: engine-recorded CVSS/CWE join the final findings mechanically
 * (corroborated live-finding match; unproven values are removed). */
export function stampFindingRefs(findings: Finding[], liveFindings: readonly LiveFinding[]): void {
  applyFindingRefs(findings, liveFindings);
}

/** Q-RP-1: the findings sheet of the deliverable package, from the same
 * model the HTML renders (own try/catch inside — never breaks the report). */
export function emitFindingsSheet(
  ctx: Ctx,
  findings: Finding[],
  bundles: ReadonlyMap<string, PocBundle>,
): void {
  emitFindingsCsv(ctx, findings, bundles);
}
