/**
 * Authorization phase (v0.19.0 refactor — extracted from phases.ts).
 */
import { type Ctx } from "../context.js";
import { type GateVerdict } from "../gate.js";
export declare function authorizePhase(ctx: Ctx): Promise<GateVerdict>;
