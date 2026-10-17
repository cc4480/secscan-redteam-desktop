/**
 * Runner bookkeeping tools: registry, target map, findings, verdicts, abort.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
export declare const QUERY_REGISTRY_TOOL: JsonSchemaTool;
export declare const UPDATE_TARGET_MAP_TOOL: JsonSchemaTool;
export declare const RECORD_FINDING_TOOL: JsonSchemaTool;
export declare const RECORD_KILLED_TOOL: JsonSchemaTool;
export declare const RECORD_ITEM_VERDICT_TOOL: JsonSchemaTool;
export declare const ABORT_TOOL: JsonSchemaTool;
