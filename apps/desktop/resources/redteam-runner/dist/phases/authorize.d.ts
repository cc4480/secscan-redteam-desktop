/**
 * Authorization phase (v0.19.0 refactor — extracted from phases.ts).
 */
import { type Ctx } from "../context.js";
import { type GateVerdict } from "../gate.js";
/**
 * The verification proof recorded in TEST MODE (REDTEAM_TEST_MODE=1,
 * operator order): an honest self-attestation that names the bypass.
 * It is deliberately NOT shaped like a DNS/service proof — anything
 * reading the record can tell no ownership verification happened.
 */
export declare const TEST_MODE_ATTESTATION = "TEST MODE: operator self-attested \u2014 ownership verification bypassed by operator order (REDTEAM_TEST_MODE)";
export declare function authorizePhase(ctx: Ctx): Promise<GateVerdict>;
