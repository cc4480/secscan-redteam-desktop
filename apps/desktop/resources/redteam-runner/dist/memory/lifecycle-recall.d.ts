/**
 * Recall pack assembly and injection, extracted from `lifecycle.ts` to
 * keep that module inside the 300-line file budget: the store-to-recall
 * adapter, the legacy EXPERIENCE slice, the recall event line, and the
 * two pack moments. Behaviour is unchanged.
 */
import type { Ctx } from "../context.js";
import type { MemoryPaths } from "./paths.js";
import { type MemoryRecallStore } from "./recall.js";
import type { MemoryStore } from "./store.js";
import type { MemoryPackResult } from "./types.js";
/**
 * Adapt the real store to recall's seam. `ensureUnitViews` regenerates
 * the named units' views per-unit first (a unit that cannot regenerate
 * is a VIEW_STALE exclusion, §8 row 9 — never a recall crash), then runs
 * the directory-threshold pass; directories left stale are reported
 * from the views index with their pending counts.
 *
 * @param store - The open store.
 * @param paths - The store paths.
 * @param nowIso - Timestamp for refreshes and receipts.
 * @returns The recall-facing store adapter.
 */
export declare function recallStoreAdapter(store: MemoryStore, paths: MemoryPaths, nowIso: string): MemoryRecallStore;
/**
 * Moment 2 (§7.1): the start pack — after authorization succeeds,
 * before planning. Query = objective + target + mode.
 *
 * @param ctx - The run context (post-authorize).
 * @returns The assembled pack (also cached on the memory state).
 */
export declare function injectStartMemory(ctx: Ctx): MemoryPackResult;
/**
 * Moment 3 (§7.1): the refresh pack — after recon, with the fingerprint.
 * Query adds stack/appType and the registry hits' vuln classes;
 * eligibility carries the ROE deny set and the class/stack context.
 *
 * @param ctx - The run context (post-recon).
 * @returns The assembled pack (also cached on the memory state).
 */
export declare function injectExploitMemory(ctx: Ctx): MemoryPackResult;
