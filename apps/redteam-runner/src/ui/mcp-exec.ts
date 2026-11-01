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

import { PROBE_TOOL, BURST_PROBE_TOOL } from "../tools/web.js";
import { HOST_TOOLS } from "../tools/host.js";
import { MSF_EXEC_TOOL } from "../tools/msf.js";
import { NUCLEI_EXEC_TOOL } from "../tools/nuclei.js";
import { NMAP_EXEC_TOOL } from "../tools/nmap.js";
import { XTOOL_DEFS } from "../tools/xtool.js";
import {
  QUERY_REGISTRY_TOOL,
  RECORD_FINDING_TOOL,
  RECORD_ITEM_VERDICT_TOOL,
  RECORD_KILLED_TOOL,
  UPDATE_TARGET_MAP_TOOL,
} from "../tools/bookkeeping.js";
import { VARIANT_LIST_TOOL } from "../variants/tool.js";
import { TOOLS } from "./mcp-tools.js";
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
import { dispatchLiveTool, getLive } from "../live.js";
import { dispatchOperatorTool } from "../operator.js";

export interface ExecToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Add the optional engagementId to a tool's schema.
 *
 * Optional, never defaulted: omitting it does NOT resolve to "the only
 * running engagement" — it selects operator mode, a direct call against
 * the target named in the arguments, in no engagement's context. Naming
 * an id selects that engagement, and if it is not running the call fails
 * rather than retargeting.
 */
function bindToEngagement(t: JsonSchemaTool): ExecToolDef {
  const params = (t.parameters ?? {}) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    name: t.name,
    description:
      t.description +
      " engagementId is OPTIONAL: pass the id of a RUNNING engagement to execute inside its context; " +
      "omit it to execute directly as an operator call against the target named in the arguments — no engagement needs to be running.",
    inputSchema: {
      type: "object",
      properties: {
        engagementId: {
          type: "string",
          description:
            "Optional. The running engagement id (e.g. eng-2026-10-15-y8fo) whose context this executes in. Omit for a direct operator call.",
        },
        ...(params.properties ?? {}),
      },
      required: [...(params.required ?? [])],
    },
    run: async (args: Record<string, unknown>): Promise<string> => {
      const raw = args["engagementId"];
      if (raw !== undefined && typeof raw !== "string") {
        throw new Error("engagementId must be a string when given");
      }
      const id = typeof raw === "string" ? raw.trim() : "";
      const rest = { ...args };
      delete rest["engagementId"];
      if (!id) {
        // Operator mode: no engagement named, none implied. The call is
        // the operator's own, against its own arguments.
        const d = await dispatchOperatorTool(t.name, rest);
        return d.result;
      }
      const d = await dispatchLiveTool(id, t.name, rest);
      // The caller gets the tool's own result verbatim: it is already written
      // for an agent to read, and rewrapping it would only lose the detail that
      // says WHY a call was refused (tier, halt, cap, scope).
      return d.result;
    },
  };
}

/**
 * All executor tools, reachable with or without a live engagement.
 *
 * The composed sets in tools/compose.ts overlap — the same tool can appear
 * in more than one phase set — so they are concatenated here and
 * de-duplicated by name, first definition winning.
 * Exposing a name twice makes tools/call ambiguous (whichever Map entry was
 * written last silently wins) and reports a tool count that is not real.
 *
 * Names already served by the COCKPIT surface are also dropped: the
 * cockpit serves the engagement-management tools (status, findings,
 * reports) for any engagement id, and shadowing one of those names with
 * an executor-side definition would quietly change what the name does.
 */
const COCKPIT_OWNED = new Set(TOOLS.map((t) => t.name));

function collect(): JsonSchemaTool[] {
  const out: JsonSchemaTool[] = [];
  const seen = new Set<string>();
  for (const t of [
    PROBE_TOOL,
    BURST_PROBE_TOOL,
    ...HOST_TOOLS,
    MSF_EXEC_TOOL,
    NUCLEI_EXEC_TOOL,
    NMAP_EXEC_TOOL,
    ...XTOOL_DEFS,
    QUERY_REGISTRY_TOOL,
    UPDATE_TARGET_MAP_TOOL,
    RECORD_FINDING_TOOL,
    RECORD_KILLED_TOOL,
    RECORD_ITEM_VERDICT_TOOL,
    VARIANT_LIST_TOOL,
  ]) {
    if (seen.has(t.name) || COCKPIT_OWNED.has(t.name)) continue;
    seen.add(t.name);
    out.push(t);
  }
  return out;
}

export const EXEC_TOOLS: ExecToolDef[] = collect().map(bindToEngagement);

export const EXEC_TOOLS_BY_NAME = new Map(EXEC_TOOLS.map((t) => [t.name, t]));

/** Just the names — used by the tests that pin the surface size. */
export const EXEC_TOOL_NAMES: string[] = EXEC_TOOLS.map((t) => t.name);

/**
 * The discovery tool: which engagements are live in this process, for
 * callers who want to aim an executor call at one. Pure discovery — no
 * executor tool depends on it; every one of them also runs with no
 * engagementId at all, as a direct operator call.
 */
export const LIST_LIVE_TOOL: ExecToolDef = {
  name: "list_live_engagements",
  description:
    "Engagements running IN THIS PROCESS, with the phase, tier, environment, in-scope hosts and the role an engagement-bound call would run as. " +
    "Passing one of these ids as engagementId makes an executor tool (nuclei_exec, msf_exec, http_probe, ssh_exec, …) execute inside that engagement's context; " +
    "omitting engagementId runs the tool directly as an operator call, whether or not anything is listed here. " +
    "An engagement that has finished — or that was launched from a different process, such as the CLI — is not listed and cannot be driven by id; " +
    "use get_engagement and get_feed to read a finished one.",
  inputSchema: { type: "object", properties: {} },
  run: async (): Promise<string> => {
    const { listLive } = await import("../live.js");
    const rows = listLive();
    if (rows.length === 0) {
      return "No engagements are running in this process. The executor tools are still available: call any of them without engagementId for a direct operator call, or start one with start_engagement to run the fleet.";
    }
    return JSON.stringify(rows, null, 2);
  },
};

/** Guard used by the endpoint: does this tool drive a live engagement? */
export function isExecTool(name: string): boolean {
  return EXEC_TOOLS_BY_NAME.has(name) || name === LIST_LIVE_TOOL.name;
}

/** Is the named engagement live here? Exposed so the endpoint can pre-refuse. */
export function engagementIsLive(id: string): boolean {
  return getLive(id) !== undefined;
}
