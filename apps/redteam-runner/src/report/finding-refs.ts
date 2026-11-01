/**
 * Report-phase hooks extracted from report/phase.ts so the orchestrator
 * stays inside the 300-line file budget. Each hook is one call into the
 * module that owns the behavior (html/wire.ts for the refs stamp,
 * csv.ts for the findings sheet, peer-verdicts.ts for the peer stamp);
 * this file only gives phase.ts its call sites. The Q-RP Batch-A hooks
 * (Q-RP-3 + Q-RP-1) landed here first; the Q-FLEET-XCHECK peer hook
 * joined them when its two phase.ts call blocks pushed the file to
 * 309 lines — its code is preserved verbatim, arguments included.
 */
import { type Ctx, type LiveFinding } from "../context.js";
import { type Finding } from "../types.js";
import { type PocBundle } from "../proof/index.js";
import { applyFindingRefs } from "./html/wire.js";
import { emitFindingsCsv } from "./csv.js";
import { applyPeerVerdicts } from "./peer-verdicts.js";

/** Q-RP-3: engine-recorded CVSS/CWE join the final findings mechanically
 * (corroborated live-finding match; unproven values are removed). */
export function stampFindingRefs(findings: Finding[], liveFindings: readonly LiveFinding[]): void {
  applyFindingRefs(findings, liveFindings);
}

/** Q-FLEET-XCHECK: the peer challenge reaches the report on the same
 * join — producer + checker stamp carried, downgrades forced to the
 * stamped rung, peer-killed/deferred matches stamped out/down. Peer
 * stamps ride the halted path too — the pass ran before the halt for
 * any finding it challenged. */
export function stampPeerVerdicts(findings: Finding[], ctx: Ctx): void {
  applyPeerVerdicts(findings, { live: ctx.liveFindings, killed: ctx.peerKilledLive ?? [], deferred: ctx.peerDeferredLive ?? [] });
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
