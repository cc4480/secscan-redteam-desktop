/**
 * Recall (brief §7.1): the only read path from the memory store into a
 * prompt. Gathers scope-eligible units through `scopeEligible` (no
 * other gate exists), refreshes stale unit views mechanically (§5.2),
 * applies decay (§6.5), runs the collapse (§6), renders the pack
 * (§6.4), and writes a recall receipt for every outcome — an empty
 * pack is a first-class, reason-coded result, never an ambiguous one.
 */
import { type CollapseCandidate, type ScoredCandidate } from "./collapse.js";
import { type ScopeEligibilityContext } from "./scope.js";
import type { MemoryPackResult, MemoryScope, MemoryUnit, RecallReceipt } from "./types.js";
/**
 * The store surface recall needs. `lifecycle.ts` adapts the real store
 * (store.ts) to this shape; tests substitute an in-memory version.
 */
export interface MemoryRecallStore {
    /** Current-version units with status active (proposed/superseded/retired excluded). */
    listActiveUnits(): MemoryUnit[];
    /**
     * Mechanical view refresh (§5.2.3): regenerate the named units' stale
     * views. Returns what was refreshed, what failed (those candidates are
     * excluded as VIEW_STALE), which directories remain stale, and the
     * post-refresh unit records.
     */
    ensureUnitViews(unitIds: string[]): {
        refreshed: string[];
        failed: string[];
        staleDirs: {
            dir: string;
            pendingUnitChanges: number;
        }[];
        units: MemoryUnit[];
    };
    /** Persist the receipt; returns its id ("<engagementId>-<phase>"). */
    writeRecallReceipt(receipt: RecallReceipt): string;
}
/** §6.6 legacy EXPERIENCE.md records, pre-built by lifecycle. */
export interface LegacyExperienceSlice {
    candidates: CollapseCandidate[];
    /** Malformed records the legacy parser skipped (§8 row 15) — surfaced, never hidden. */
    skipped: number;
}
export interface AssemblePackOptions {
    phase: "start" | "exploit";
    query: string;
    engagementId: string;
    eligibility?: ScopeEligibilityContext;
    /** Resolved at config time from REDTEAM_MEMORY_BUDGET; default 6. */
    budget?: number;
    /** Injected clock for decay; defaults to the current time. */
    now?: Date;
    legacy?: LegacyExperienceSlice;
}
/**
 * §6.5 decay factor for a unit at `now`. Only trajectory/experience
 * sources decay at all; the proof-registry and operator exemptions and
 * the baseScore >= 0.7 exemption are checked before the curve applies.
 */
export declare function decayFactor(unit: MemoryUnit, now: Date): number;
/** Render the pack text (§6.4): L0 for all survivors, L1 for the top 3, L2 never. */
export declare function renderMemoryPack(input: {
    survivors: ScoredCandidate[];
    unitsById: Map<string, MemoryUnit>;
    receiptId: string;
    staleDirs: {
        dir: string;
        pendingUnitChanges: number;
    }[];
}): string;
/**
 * Assemble one memory pack (brief §7.1 Moments 2–3). Writes the recall
 * receipt through the store for EVERY outcome, including empty ones.
 */
export declare function assembleMemoryPack(store: MemoryRecallStore, scope: MemoryScope, opts: AssemblePackOptions): MemoryPackResult;
