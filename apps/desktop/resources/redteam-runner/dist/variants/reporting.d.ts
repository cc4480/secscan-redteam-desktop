/**
 * Honest variant counting for reports (v0.20.0).
 *
 * The anti-AI-washing posture: "418 attack intents" and "N variant
 * executions" are reported as TWO numbers, never merged into one
 * inflated "attacks" figure. A competitor-style single number is
 * exactly what we refuse to print.
 */
import type { ItemVerdict } from "../coverage/items.js";
import type { VariantCounts } from "./types.js";
export declare function countVariants(ledger: Map<string, ItemVerdict>): VariantCounts;
/** One-line honest summary for the battery coverage line. */
export declare function variantCountLine(c: VariantCounts): string;
/** Per-item variant progress suffix for the reconciliation list. */
export declare function variantProgressSuffix(v: ItemVerdict): string;
