/**
 * Composed tool sets per phase (withBatteryItem tagging).
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
export declare const RECON_TOOLS: JsonSchemaTool[];
export declare const EXPLOIT_TOOLS: JsonSchemaTool[];
/**
 * The coordinator's command tools: no probes, only command authority.
 * The one command tool this set carried — abort_engagement, the fleet
 * kill switch — was removed on the operator's order (2026-11-01): no
 * stop signal may halt a run. The set stays as the composition point,
 * currently empty.
 */
export declare const COMMAND_TOOLS: JsonSchemaTool[];
