/**
 * Cell-level coverage views (v0.19.0 refactor — extracted from phases.ts).
 *
 * batteryStatusLine: the compact coverage line for prompts and reports.
 * sharedStateDigest: the [SHARED STATE] block appended to every tool
 * result so no agent works from a stale picture. (Per-item verdicts live
 * in ./items.ts.)
 */
import { type EngagementPhase } from "../types.js";
import { type Ctx } from "../context.js";
/**
 * Runner-computed battery coverage line. Generic engagements: 3 global
 * categories. Full-battery engagements: 3 categories × selected targets
 * (12 cells by default). ✓ probed · ⊘ blocked (prerequisite) · … missing.
 */
export declare function batteryStatusLine(ctx: Ctx): string;
/** Compact shared-state digest appended to every tool result — the team's common picture, never stale. */
export declare function sharedStateDigest(ctx: Ctx, phase: EngagementPhase): string;
