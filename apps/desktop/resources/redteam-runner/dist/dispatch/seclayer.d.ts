/**
 * Native Seclayer module tool handlers (verification-gated).
 *
 * Runs the embedded Seclayer non-repeat modules in-process (vendored
 * under src/seclayer/, compiled to dist/seclayer/) instead of through
 * the Seclayer service. Every tool here fires ACTIVE web app tests —
 * real exploit attempts, authenticated two-identity probes, fuzzing —
 * so every call is refused unless owner verification is on the
 * engagement record (ctx.verificationProof, recorded by the authorize
 * phase after the owner proves the target is theirs, spec rule 7).
 * The refusal is agent-readable on purpose: it tells the fleet to
 * secure verification first and retry, exactly like secscan_exec's
 * deep tier.
 *
 * Findings flow onto the same proven path as every other tool:
 * verbatim severity/title per finding, PII redaction, the append-only
 * live list, the verdict registry, and a state sync.
 */
import { type BatteryCategory } from "../battery.js";
import { type TargetId } from "../targets.js";
import { type Ctx, type LiveFinding } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
import type { BolaIdentity } from "#seclayer/src/types.js";
export declare const SECLAYER_TOOL_NAMES: Set<string>;
export declare function strArg(args: Record<string, unknown>, key: string): string | undefined;
export declare function headersArg(args: Record<string, unknown>): Record<string, string>;
export interface SeclayerPrelude {
    attackId?: string;
    category?: BatteryCategory;
    targetProfile: TargetId;
    url: string;
    headers: Record<string, string>;
}
/** Shared gate for every Seclayer tool: ROE, scope-shaped args, and the
 * verification gate. Returns a denial DispatchResult, or the parsed
 * prelude when the call may proceed. */
export declare function seclayerPrelude(ctx: Ctx, call: ToolCallRequest, args: Record<string, unknown>): SeclayerPrelude | DispatchResult;
export declare function isDenial(x: SeclayerPrelude | DispatchResult): x is DispatchResult;
/** One raw Seclayer finding (every module family shares this shape). */
export interface RawSeclayerFinding {
    testName?: string;
    title?: string;
    payload?: string;
    severity?: string;
    description?: string;
    fix?: string;
    endpoint?: string;
    evidence?: unknown;
}
/** Map a Seclayer module finding onto the runner's finding shape,
 * verbatim: module severity, the probe's own test name as the title,
 * its demonstrated receipt as the evidence. */
export declare function seclayerFindingToLive(f: RawSeclayerFinding, attackId: string | undefined, vulnClass: string): LiveFinding;
/** Record a batch of module findings on the proven path and summarize. */
export declare function recordSeclayerFindings(ctx: Ctx, tool: string, url: string, raw: RawSeclayerFinding[], pre: SeclayerPrelude, vulnClass: string, producer?: ActorRole): DispatchResult;
export declare function bolaIdentitiesFromArgs(args: Record<string, unknown>): [BolaIdentity, BolaIdentity] | undefined;
export declare function handleSeclayerTools(ctx: Ctx, _role: ActorRole, _phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>): Promise<DispatchResult | null>;
