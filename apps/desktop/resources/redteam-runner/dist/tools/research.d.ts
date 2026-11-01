/**
 * Web research tool definitions (deep-research-osint execution layer).
 *
 * Named research_* rather than web_*: the PC bridge already offers the
 * fleet tools literally named web_search/web_fetch when it is
 * connected, and a catalog must never carry two tools under one name.
 * These are the runner-native pair the research skill's contract
 * assumes — available with no bridge, no extra service, and no key.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
export declare const RESEARCH_SEARCH_TOOL: JsonSchemaTool;
export declare const RESEARCH_FETCH_TOOL: JsonSchemaTool;
export declare const RESEARCH_TOOLS: JsonSchemaTool[];
