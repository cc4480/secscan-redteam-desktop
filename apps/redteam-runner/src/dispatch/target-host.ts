/**
 * Target-host resolution for tool calls (extracted from router.ts, which
 * sits at the 300-line file budget; router.ts re-exports RATE_LIMITED_TOOLS
 * so existing imports keep working).
 */
import { type ToolCallRequest } from "@secscan/redteam-llm-router";
import { XTOOLS } from "../xtool/registry.js";

/**
 * Tool names owned by the external-tool bridge. Kept as an explicit set because
 * an `_exec` suffix is NOT a safe discriminator — it also matches the host-exec
 * family (ssh_exec, smb_exec, winrm_exec, …), which has no `action` argument.
 */
const XTOOL_TOOL_NAMES = new Set(XTOOLS.map((t) => `${t.id}_exec`));

/**
 * Tools whose calls generate traffic against a target host. Tools without a
 * resolvable target host (shared-state tools, MCP read-only tools) skip the
 * limiter — they generate no target traffic.
 *
 * Exported so test/tool-family-consistency.test.ts can assert that every host
 * tool the runner exposes is actually rate-limited and auto-halt tracked. A
 * tool missing from this set fires real traffic with no limiter at all, which
 * is exactly the class of gap the nmap scope check fell into.
 */
export const RATE_LIMITED_TOOLS = new Set([
  "http_probe",
  "burst_probe",
  "secscan_exec",
  "ssh_exec",
  "smb_exec",
  "winrm_exec",
  "winrm_probe",
  "rdp_auth",
  "rdp_shadow_prep",
  "smb_pth",
  "ad_enum",
  "krb_ptt",
  "ssh_agent_audit",
  "nfs_enum",
  "msf_exec",
  "nuclei_exec",
  "nmap_exec",
  "sqlmap_exec",
  "ffuf_exec",
  "gobuster_exec",
  "nikto_exec",
  "seclayer_redteam",
  "seclayer_bola",
  "seclayer_api",
  "seclayer_webhook",
  "seclayer_dast",
  "seclayer_aggressive",
]);

/** Best-effort target host for a tool call — undefined when the tool has no target traffic. */
export function toolTargetHost(call: ToolCallRequest): string | undefined {
  if (!RATE_LIMITED_TOOLS.has(call.name)) return undefined;
  const args = call.arguments as Record<string, unknown> | undefined ?? {};
  // v0.21.0: nuclei_exec templates is local-only (reads the operator's
  // template checkout) — no target traffic, so no limiter/halt applies.
  if (call.name === "nuclei_exec" && args["action"] !== "run") return undefined;
  // v0.31.0: nmap_exec profiles runs `nmap --version` locally — no target
  // traffic, so no limiter and no auto-halt applies.
  if (call.name === "nmap_exec" && args["action"] !== "scan") return undefined;
  // v0.32.0: an xtool probe runs nothing; john_exec is offline entirely.
  //
  // The xtool names are listed EXPLICITLY rather than matched with an `_exec`
  // suffix test. A suffix test also matches ssh_exec, smb_exec, winrm_exec and
  // the rest of the host-exec family — none of which take an `action`
  // argument — so it returned undefined for every one of them and silently
  // removed them from the rate limiter and the auto-halt tracker. The chaining
  // test caught it: a second ssh_exec against the same target fired instead of
  // being refused.
  if (XTOOL_TOOL_NAMES.has(call.name) && args["action"] !== "run") return undefined;
  if (call.name === "john_exec") return undefined;
  const direct = typeof args["host"] === "string" ? (args["host"] as string).trim().toLowerCase() : "";
  if (direct) {
    // URL-taking tools (sqlmap/ffuf/gobuster/nikto) take the target in `host`
    // as a full URL. Key on the hostname so varying the path/query/scheme cannot
    // mint a fresh rate-limit bucket (and defeat auto-halt) for the same host.
    try {
      return new URL(direct).hostname.toLowerCase();
    } catch {
      return direct;
    }
  }
  const url = typeof args["url"] === "string" ? (args["url"] as string) : "";
  if (url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }
  return undefined;
}
