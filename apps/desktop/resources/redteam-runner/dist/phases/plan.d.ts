/**
 * Planning phase (v0.19.0 refactor — extracted from phases.ts).
 */
import { type Ctx } from "../context.js";
export declare function planPhase(ctx: Ctx, critique?: string): Promise<void>;
/**
 * Commander-ordered focused re-recon. Used when the exploiter hits a wall
 * (mechanical wall detection) or when the coordinator redirects the
 * recon→exploit handoff. Writes to the shared target map as it goes.
 */
/** Commander-ordered focused exploitation (redirect on the exploit→report handoff). */
