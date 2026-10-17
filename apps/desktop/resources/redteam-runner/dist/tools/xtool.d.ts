/**
 * Tool definitions for the external-tool bridges (v0.32.0).
 *
 * Generated from the registry rather than hand-written five times, so a tool
 * that gains a profile gains it here automatically and the schemas cannot drift
 * from what the executor will accept.
 *
 * The agent picks a TOOL, an ACTION, a PROFILE and a TARGET. It never supplies a
 * flag: `checkXToolFlags` refuses anything beginning with "-" and every argv is
 * built runner-side from the profile table.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
import { type XToolSpec } from "../xtool/registry.js";
export declare function xToolDef(spec: XToolSpec): JsonSchemaTool;
export declare const XTOOL_DEFS: JsonSchemaTool[];
export declare const XTOOL_DEFS_BY_NAME: Map<string, JsonSchemaTool>;
