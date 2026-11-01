/**
 * MCP surface for the runner's EXECUTOR tools (v0.30.0; ungated v0.31.0).
 *
 * The 13 tools in mcp-tools.ts drive ENGAGEMENTS. These 27 are the tooling
 * itself: nuclei_exec, msf_exec, http_probe, ssh_exec, ad_enum,
 * query_registry, and the rest.
 *
 * engagementId is OPTIONAL, and the two modes are kept strictly apart:
 *
 *   - WITH the id of a running engagement, the call goes through
 *     dispatchLiveTool -> dispatchTool and executes inside that
 *     engagement's context, under exactly the machinery the engagement's
 *     own agents run under. A non-live id is an honest error — it never
 *     falls back to operator mode, because a call aimed at an engagement
 *     must not silently retarget.
 *   - WITHOUT an id, the call executes directly as an operator call
 *     (src/operator.ts): the operator's own target, named in the call's
 *     arguments, with no engagement to belong to and no liveness, tier or
 *     scope gate in front of it. Carlos's order (2026-11-01): the tools
 *     are not gated on an engagement existing.
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
 * The discovery tool: which engagements are live in this process, for
 * callers who want to aim an executor call at one. Pure discovery — no
 * executor tool depends on it; every one of them also runs with no
 * engagementId at all, as a direct operator call.
 */
export declare const LIST_LIVE_TOOL: ExecToolDef;
/** Guard used by the endpoint: does this tool drive a live engagement? */
export declare function isExecTool(name: string): boolean;
/** Is the named engagement live here? Exposed so the endpoint can pre-refuse. */
export declare function engagementIsLive(id: string): boolean;
