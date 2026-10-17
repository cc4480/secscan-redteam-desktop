/**
 * Finding/verdict helpers: live-finding sync, registry writes, verdict-block merge (v0.19.0 refactor — extracted from dispatch.ts).
 */
import { type Ctx, type KilledLive, type LiveFinding } from "../context.js";
import { type EngagementPhase } from "../types.js";
export declare function recordItemAttempt(ctx: Ctx, args: Record<string, unknown>, phase: EngagementPhase): void;
/** Mirror live findings into state.json so the console shows them as they land. */
export declare function syncLiveFindingsToState(ctx: Ctx): void;
/** Write a confirmed finding to the registry (deduped per engagement) and persist. */
export declare function writeFindingToRegistry(ctx: Ctx, lf: LiveFinding): void;
/** Write a killed hypothesis to the registry (deduped per engagement) and persist. */
export declare function writeKilledToRegistry(ctx: Ctx, kl: KilledLive): void;
/** Merge the exploiter's final VERDICTS JSON block into shared state + registry (backstop for verdicts never recorded live). */
export declare function mergeVerdictBlock(ctx: Ctx, text: string): void;
