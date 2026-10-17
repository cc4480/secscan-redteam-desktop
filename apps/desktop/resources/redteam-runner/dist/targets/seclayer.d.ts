/**
 * SecLayer target profile — the MCP/API layer (https://secscan.us/api/mcp).
 *
 * EXHAUSTIVE battery (v0.7.0): surface × technique. Surfaces: MCP
 * initialize/handshake, capability negotiation, tools/list, tools/call for
 * EACH tool (seclayer_scan, seclayer_list_scans, seclayer_get_report) with
 * every parameter attacked individually, notifications, ping,
 * cancellation, progress, batching, the JSON-RPC layer itself, the auth
 * layer per method, and WAF behavior.
 *
 * Non-destructive always: benign canary targets only, no real bypass
 * campaigns, no emails to real users. Items needing setup say so in
 * `needs` — honestly.
 */
import type { TargetProfile } from "./types.js";
export declare const SECLAYER_PROFILE: TargetProfile;
