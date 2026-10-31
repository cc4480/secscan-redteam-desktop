/**
 * MCP surface for the runner's EXECUTOR tools (v0.30.0).
 *
 * The 13 tools in mcp-tools.ts drive ENGAGEMENTS. These 32 drive the tools
 * INSIDE a running engagement: nuclei_exec, msf_exec, http_probe, ssh_exec,
 * ad_enum, query_registry, and the rest. Without them an operator could start
 * an engagement and read its results but never reach the tooling itself, which
 * is the whole point of a harness-connected red team.
 *
 * Every tool requires an engagementId, and every call goes through
 * dispatchLiveTool -> dispatchTool, so the kill switch, the tier ladder,
 * auto-halt, the per-host rate limiter and the per-item variant cap all run
 * first. A Tier-1 call to `msf_exec run` is refused with the reason, exactly as
 * it would be for the engagement's own agents. This file adds reach, not
 * authority.
 *
 * The schemas are NOT duplicated: they are the same JsonSchemaTool objects the
 * agents are given, with `engagementId` added. A tool that changes its
 * parameters changes here automatically — the alternative, a hand-copied
 * schema, drifts the moment someone edits tools/*.ts.
 */
export interface ExecToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    run: (args: Record<string, unknown>) => Promise<string>;
}
export declare const EXEC_TOOLS: ExecToolDef[];
export declare const EXEC_TOOLS_BY_NAME: Map<string, ExecToolDef>;
/** Just the names — used by the tests that pin the surface size. */
export declare const EXEC_TOOL_NAMES: string[];
/**
 * The discovery tool. An agent that cannot tell what is live cannot use any of
 * the 26, and "which engagement?" is the first question every one of them
 * requires answering.
 */
export declare const LIST_LIVE_TOOL: ExecToolDef;
/** Guard used by the endpoint: does this tool drive a live engagement? */
export declare function isExecTool(name: string): boolean;
/** Is the named engagement live here? Exposed so the endpoint can pre-refuse. */
export declare function engagementIsLive(id: string): boolean;
