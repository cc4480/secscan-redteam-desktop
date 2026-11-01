/**
 * TEST MODE dispatch helpers (REDTEAM_TEST_MODE, operator order).
 *
 * Test mode is an engagement-level posture resolved once in
 * phases/config.ts (ResolvedRunnerConfig.testMode). The dispatch layer
 * reads it through here so every enforcement point answers the same
 * question the same way — including from partial test contexts that
 * carry no config at all (hence the optional chain: absent = off).
 *
 * A bypass is never silent: noteTestModeBypass appends a
 * test_mode_bypass event naming the gate that would have refused, so
 * the engagement log shows exactly which restraints were lifted, where,
 * and for which target. The authorize phase's test_mode_active event is
 * the engagement-level record; these are the per-call receipts.
 */
import type { Ctx } from "../context.js";
import type { EngagementPhase } from "../types.js";
/** True when this engagement runs under TEST MODE. */
export declare function testModeOn(ctx: Ctx): boolean;
/** Append the per-call receipt for a gate bypassed under TEST MODE. */
export declare function noteTestModeBypass(ctx: Ctx, phase: EngagementPhase, target: string | undefined, what: string): void;
