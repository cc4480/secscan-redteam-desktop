/**
 * Variant execution tracking (v0.20.0) — per-engagement, mechanical.
 *
 * The flow:
 *  1. Agent calls variant_list(batteryItem) → startVariantExpansion opens
 *     expansion on the item's ledger verdict (reopening executed-clean →
 *     pending for deeper testing; executed-clean is not a final
 *     disposition, so the move is allowed).
 *  2. Agent executes variants via the normal tools with batteryItem +
 *     variantIndex tagged. checkVariantCap denies past the cap BEFORE any
 *     packet — one item can't spray.
 *  3. Each clean variant execution → recordVariantExecution increments;
 *     when executed >= planned (min(librarySize, cap)) the item settles to
 *     executed-clean with the honest counts.
 *  4. Agent may close early via variant_list(closeExpansion: true) — the
 *     report shows exactly what ran.
 *  5. record_finding with a variant-tagged batteryItem → confirmed (and
 *     variants.confirmed++).
 *
 * While expansion is open, recordItemAttempt's plain executed-clean flip
 * is skipped (see dispatch/verdicts.ts) — the tracker owns the disposition.
 */
import type { Ctx } from "../context.js";
import type { EngagementPhase } from "../types.js";
import type { TargetBatteryItem } from "../targets/types.js";
import { type ItemVerdict } from "../coverage/items.js";
import type { Variant, VariantClass } from "./types.js";
/** Defaults: 25 variants/item staging, 10 production (lower blast radius). */
export declare const DEFAULT_VARIANT_CAP_STAGING = 25;
export declare const DEFAULT_VARIANT_CAP_PRODUCTION = 10;
export declare function resolveVariantCap(environment: "staging" | "production", configured?: number): number;
/** Find the battery item for a ledger key ("secscan:SS-042"). */
export declare function findBatteryItem(key: string): TargetBatteryItem | undefined;
/** True while an item's variant expansion is open and unexhausted. */
export declare function hasActiveVariantExpansion(ledger: Map<string, ItemVerdict>, key: string): boolean;
export interface ExpansionOpened {
    variants: Variant[];
    classes: VariantClass[];
    librarySize: number;
    cap: number;
    reopened: boolean;
}
/**
 * Open variant expansion for an item. Idempotent: calling twice returns
 * the same capped list — progress is NEVER reset.
 */
export declare function startVariantExpansion(ctx: Ctx, key: string, phase: EngagementPhase): ExpansionOpened;
/**
 * Cap check — call BEFORE dispatch. Returns a DENIED message when a
 * variant-tagged call would exceed the item's cap, else undefined.
 */
export declare function checkVariantCap(ledger: Map<string, ItemVerdict>, args: Record<string, unknown>): string | undefined;
/**
 * Record a clean variant-tagged execution. Settles the item to
 * executed-clean when its variants are exhausted (or the cap cut the
 * library short) — with the honest counts in the reason.
 */
export declare function recordVariantExecution(ctx: Ctx, args: Record<string, unknown>, phase: EngagementPhase): void;
/**
 * Agent-declared early close: "I've run enough variants." The report shows
 * exactly what ran — executed/planned — so closing early is transparent,
 * not a bypass.
 */
export declare function closeVariantExpansion(ctx: Ctx, key: string, phase: EngagementPhase): string;
