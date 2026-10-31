/**
 * Battery-item → variant-class classification (v0.20.0).
 *
 * Mechanical text matching over the item's own fields (owasp, name, brief,
 * what). No LLM judgment, no guessing: a class applies only when the
 * item's text names the attack shape. Deterministic — same item, same
 * classes, every run.
 */
import type { TargetBatteryItem } from "../targets/types.js";
import type { VariantClass, VariantPayload } from "./types.js";
/** All payloads for one class (the curated library, uncut). */
export declare function libraryForClass(cls: VariantClass): VariantPayload[];
/** Total payloads across every library. */
export declare function totalLibrarySize(): number;
/**
 * Which variant classes apply to a battery item. Order matters: SSRF is
 * checked before open-redirect because SSRF items discuss redirect chains.
 */
export declare function classifyItem(item: TargetBatteryItem): VariantClass[];
/** All curated payloads for an item's classes, in class order. */
export declare function buildVariantsForClasses(classes: VariantClass[]): VariantPayload[];
