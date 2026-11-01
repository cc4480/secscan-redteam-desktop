/**
 * Dispatch prelude helpers (v0.19.0 refactor — extracted from dispatch.ts).
 */
import { type Ctx } from "../context.js";
import { type BatteryCategory } from "../battery.js";
import { type TargetId } from "../targets.js";
/** Optional string arg: trimmed, or undefined when absent/blank. */
export declare function optStr(v: unknown): string | undefined;
/** Optional positive-number arg, or undefined when absent/invalid. */
export declare function numArg(v: unknown): number | undefined;
/**
 * Optional string-list arg: trimmed non-empty entries, or undefined when the
 * arg is absent or yields nothing. Was copy-pasted identically into the nmap,
 * nuclei and xtool handlers.
 */
export declare function strListArg(args: Record<string, unknown>, key: string): string[] | undefined;
/**
 * Record a tagged battery category against the engagement's coverage — the
 * identical bookkeeping every target-facing handler performs before it sends
 * traffic. It appeared, byte-for-byte apart from the cell key, in six handlers
 * (host, msf, nmap, nuclei, web, xtool); one copy means the category list and
 * the coverage-state shape cannot drift between them.
 *
 * Does NOT touch `ctx.probesUsed`: handlers disagree on whether an attempt
 * counts as a probe (xtool only counts when it is not offline), so each caller
 * keeps that decision next to its own call.
 *
 * `targetProfile` names the per-target battery cell. Omit it only when the tool
 * has no target cell to attribute (offline jobs); the global category coverage
 * is recorded regardless.
 */
export declare function noteCategoryCoverage(ctx: Ctx, category: BatteryCategory | undefined, targetProfile?: TargetId): void;
