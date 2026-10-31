/**
 * Composed tool sets per phase (withBatteryItem tagging).
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
export declare const RECON_TOOLS: JsonSchemaTool[];
export declare const EXPLOIT_TOOLS: JsonSchemaTool[];
/** The coordinator's command tools: no probes, only command authority. */
export declare const COMMAND_TOOLS: JsonSchemaTool[];
