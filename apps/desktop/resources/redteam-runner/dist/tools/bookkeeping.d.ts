/**
 * Runner bookkeeping tools: registry, target map, findings, verdicts.
 */
import type { JsonSchemaTool } from '@secscan/redteam-llm-router';
export declare const QUERY_REGISTRY_TOOL: JsonSchemaTool;
export declare const UPDATE_TARGET_MAP_TOOL: JsonSchemaTool;
export declare const RECORD_FINDING_TOOL: JsonSchemaTool;
export declare const RECORD_KILLED_TOOL: JsonSchemaTool;
export declare const RECORD_ITEM_VERDICT_TOOL: JsonSchemaTool;
export declare const READ_SPILL_TOOL: JsonSchemaTool;
export declare const LOAD_SKILL_TOOL: JsonSchemaTool;
