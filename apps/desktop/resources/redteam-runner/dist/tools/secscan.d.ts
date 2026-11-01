/**
 * Native SecScan engine tool definition.
 *
 * The SecScan check suite is embedded in the runner (src/secscan/, a
 * byte-frozen vendored copy of the service's engine) and runs in-process
 * through this tool — the native module passed parity against the live
 * service (2026-10-28) and the MCP `scan_url` wrapper was retired, per
 * the embed spec; this is the only scan surface. One tool, one
 * scan: the engine's probes already run in parallel internally, and the
 * scope gate, autonomy-tier ladder, rate limiter, and duplicate guard
 * all apply at dispatch exactly as they do for the other bridges.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
export declare const SECSCAN_EXEC_TOOL: JsonSchemaTool;
