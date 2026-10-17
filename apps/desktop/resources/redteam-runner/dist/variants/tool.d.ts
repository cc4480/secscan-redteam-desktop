/**
 * variant_list agent tool definition (v0.20.0).
 *
 * Tier 0 bookkeeping: returns curated payload variants for a battery
 * item's attack class — never fires anything itself. The agent executes
 * variants through the normal tools with batteryItem + variantIndex tagged;
 * the per-item cap is enforced mechanically in dispatch.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
export declare const VARIANT_LIST_TOOL: JsonSchemaTool;
