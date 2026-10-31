/**
 * Reconnaissance phase (v0.19.0 refactor — extracted from phases.ts).
 */
import { type Ctx } from "../context.js";
export declare function reconPhase(ctx: Ctx): Promise<string>;
/** A discrete unit of work: one task, one specialist, one objective. */
