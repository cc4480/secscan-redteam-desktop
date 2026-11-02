/**
 * Composed tool sets per phase (withBatteryItem tagging).
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
import { BURST_PROBE_TOOL, PROBE_TOOL } from "./web.js";
import { RESEARCH_TOOLS } from "./research.js";
import { SECSCAN_EXEC_TOOL } from "./secscan.js";
import {
  SECLAYER_REDTEAM_TOOL,
  SECLAYER_BOLA_TOOL,
  SECLAYER_API_TOOL,
  SECLAYER_WEBHOOK_TOOL,
  SECLAYER_DAST_TOOL,
  SECLAYER_AGGRESSIVE_TOOL,
} from "./seclayer.js";
import { HOST_TOOLS } from "./host.js";
import { MSF_EXEC_TOOL } from "./msf.js";
import { NUCLEI_EXEC_TOOL } from "./nuclei.js";
import { NMAP_EXEC_TOOL } from "./nmap.js";
import { NET_EXEC_TOOL } from "./net.js";
import { XTOOL_DEFS } from "./xtool.js";
import { QUERY_REGISTRY_TOOL, READ_SPILL_TOOL, RECORD_FINDING_TOOL, RECORD_ITEM_VERDICT_TOOL, RECORD_KILLED_TOOL, UPDATE_TARGET_MAP_TOOL } from "./bookkeeping.js";
import { VARIANT_LIST_TOOL } from "../variants/tool.js";
import { PC_AGENT_TOOLS } from "./pc-agent.js";

const BATTERY_ITEM_HINT =
  ' Always include batteryItem: the battery item ID under test (e.g. "SS-042"). ' +
  "The runner tracks one verdict per battery item and the battery cannot report complete while any item is pending.";

function withBatteryItem(t: JsonSchemaTool): JsonSchemaTool {
  const params = (t.parameters ?? {}) as { properties?: Record<string, unknown> };
  return {
    ...t,
    description: t.description + BATTERY_ITEM_HINT,
    parameters: {
      ...params,
      properties: {
        ...(params.properties ?? {}),
        batteryItem: {
          type: "string",
          description:
            'Battery item ID this action tests (e.g. "SS-042", "WS-023"). Untagged actions cannot be reconciled to an item.',
        },
        // v0.20.0 variants: tag a variant_list payload index. Variant-tagged
        // executions count toward the item's variant expansion (per-item cap
        // enforced mechanically in dispatch).
        variantIndex: {
          type: "number",
          description:
            "Payload variant index from variant_list for this battery item. Optional — omit for single-probe (non-variant) executions.",
        },
      },
    },
  };
}

const RECON_SET = [withBatteryItem(SECSCAN_EXEC_TOOL), ...HOST_TOOLS.map(withBatteryItem), withBatteryItem(MSF_EXEC_TOOL), withBatteryItem(NUCLEI_EXEC_TOOL), withBatteryItem(NMAP_EXEC_TOOL), withBatteryItem(NET_EXEC_TOOL), ...XTOOL_DEFS.map(withBatteryItem), ...PC_AGENT_TOOLS, QUERY_REGISTRY_TOOL, READ_SPILL_TOOL, UPDATE_TARGET_MAP_TOOL, withBatteryItem(RECORD_ITEM_VERDICT_TOOL), VARIANT_LIST_TOOL, ...RESEARCH_TOOLS];
const EXPLOIT_SET = [withBatteryItem(PROBE_TOOL), withBatteryItem(BURST_PROBE_TOOL), ...HOST_TOOLS.map(withBatteryItem), withBatteryItem(MSF_EXEC_TOOL), withBatteryItem(NUCLEI_EXEC_TOOL), withBatteryItem(NMAP_EXEC_TOOL), withBatteryItem(NET_EXEC_TOOL), ...PC_AGENT_TOOLS, QUERY_REGISTRY_TOOL, READ_SPILL_TOOL, withBatteryItem(RECORD_FINDING_TOOL), withBatteryItem(RECORD_KILLED_TOOL), withBatteryItem(RECORD_ITEM_VERDICT_TOOL), VARIANT_LIST_TOOL, withBatteryItem(SECLAYER_REDTEAM_TOOL), withBatteryItem(SECLAYER_BOLA_TOOL), withBatteryItem(SECLAYER_API_TOOL), withBatteryItem(SECLAYER_WEBHOOK_TOOL), withBatteryItem(SECLAYER_DAST_TOOL), withBatteryItem(SECLAYER_AGGRESSIVE_TOOL), ...RESEARCH_TOOLS];

function dedupeByName(tools: JsonSchemaTool[]): JsonSchemaTool[] {
  const seen = new Set<string>();
  const out: JsonSchemaTool[] = [];
  for (const t of tools) {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      out.push(t);
    }
  }
  return out;
}

/**
 * Universal access — operator's order 2026-11-01: every fleet seat holds
 * the FULL tool catalog ("I want all of the agents to have full control of
 * those tools"). RECON_TOOLS, EXPLOIT_TOOLS and COMMAND_TOOLS all export
 * the deduplicated union of the former recon and exploit sets, so the
 * coordinator, recon, exploiter, coder and reporter seats are offered the
 * identical catalog. This supersedes the Q-RP-6 per-role restriction
 * (recon/exploit subsets; the coordinator command-only — its set carried
 * only the abort_engagement kill switch until that was removed on the
 * operator's order earlier on 2026-11-01). Phase names survive as the
 * composition points; access no longer varies by phase. Seat prompts are
 * unchanged: role guidance still describes each seat's job, but the
 * mechanical bar on tool access is gone. Scope, ROE and the dispatch
 * guards still bind every call — universal access is not universal reach.
 */
export const FULL_TOOLS: JsonSchemaTool[] = dedupeByName([...RECON_SET, ...EXPLOIT_SET]);
export const RECON_TOOLS = FULL_TOOLS;
export const EXPLOIT_TOOLS = FULL_TOOLS;
export const COMMAND_TOOLS: JsonSchemaTool[] = FULL_TOOLS;
