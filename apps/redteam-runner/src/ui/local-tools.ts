/**
 * Q-RP-11 — the chat-shaped LOCAL engagement launch.
 *
 * engagement_launch (engagement-tools.ts) starts an engagement on a
 * target the user named. A local host assessment names no target: the
 * target IS the machine this app runs on, and the old /pcscan shell
 * faked that by re-aiming the remote battery at os.hostname() — checks
 * that needed SMB/WinRM/SSH services and test credentials on the very
 * workstation being assessed, which is the failure the local mode
 * exists to avoid (parity audit row 23).
 *
 * engagement_launch_local is the honest surface: the launch body is
 * built mechanically from the machine's own hostname (target = scope =
 * hostname, the windows family, localHost: true) and handed to the
 * SAME handleLaunch route, so launch validation, the authorize
 * attestation, and tier rules apply unchanged. With localHost set, the
 * runner collects the host inventory on-host during recon and the
 * report renders the host-inventory sections from it.
 *
 * The console chat and the desktop host's chat consume one MCP tool
 * list (mcp-endpoint.ts), so this tool appears on both surfaces.
 */
import { hostname } from "node:os";
import { capture, type ToolDef } from "./mcp-tools.js";
import { handleLaunch } from "./routes/engagements.js";
import type { UiLaunchRequest } from "./types.js";

const str = (d: string): Record<string, unknown> => ({ type: "string", description: d });

/**
 * Build the launch request for a local engagement: the machine's own
 * hostname as target and sole scope entry, the windows target family,
 * and the localHost marker the collector keys on. The objective
 * defaults to the local-assessment ask when the caller gave none —
 * unlike a remote launch, there is no user-named target sentence to
 * require, because the user asked about THIS machine.
 *
 * @param a - The tool arguments as the agent supplied them.
 * @param host - The local hostname (injectable for tests).
 * @returns The launch request.
 */
export function buildLocalLaunchBody(a: Record<string, unknown>, host: string = hostname()): { body: UiLaunchRequest } {
  const objective =
    typeof a["objective"] === "string" && a["objective"].trim()
      ? a["objective"].trim()
      : "Assess this workstation: local inventory, posture, and an HTML report";
  const body: UiLaunchRequest = {
    target: host,
    mode: a["mode"] === "black" ? "black" : "red",
    objective,
    scope: [host],
    targets: ["windows"],
    localHost: true,
  };
  const operatorName = typeof a["operatorName"] === "string" && a["operatorName"].trim() ? a["operatorName"].trim() : undefined;
  const client = typeof a["client"] === "string" && a["client"].trim() ? a["client"].trim() : undefined;
  if (operatorName) body.operatorName = operatorName;
  else if (!client) body.operatorName = "the desktop user";
  if (client) body.client = client;
  if (a["tier"] === 0 || a["tier"] === 1 || a["tier"] === 2) body.tier = a["tier"];
  if (a["dryRun"] === true) body.dryRun = true;
  return { body };
}

/** engagement_launch_local — see the module doc for the design. */
const localLaunchTool: ToolDef = {
  name: "engagement_launch_local",
  description:
    "Start a LOCAL host assessment of the machine this app is running on — the fulfilment tool when the user asks to scan, audit, " +
    "or test THIS computer / workstation / PC. It runs the in-house pipeline in local mode: inventory and posture are collected " +
    "on-host (no network services or test credentials needed on the target), and the finished report carries the host-inventory " +
    "sections. There is no target argument — the machine assesses itself. After launching, poll engagement_status and narrate " +
    "each phase change; when the run completes, call engagement_report and deliver the report in the thread.",
  inputSchema: {
    type: "object",
    properties: {
      objective: str("The user's ask, in their words (optional — a local-assessment objective is used when omitted)"),
      mode: { type: "string", enum: ["red", "black"], description: "red = full knowledge (default), black = no prior knowledge" },
      operatorName: str("The user asking, by name — the operator the engagement record attests"),
      client: str("Client name for the report; also attests when no operator is named"),
      tier: { type: "integer", enum: [0, 1, 2], description: "Autonomy tier" },
      dryRun: { type: "boolean", description: "Plan only; touch nothing" },
    },
    required: [],
    additionalProperties: false,
  },
  run: async (store, a) => {
    const built = buildLocalLaunchBody(a);
    const c = capture();
    await handleLaunch(store, {} as never, c.res, built.body);
    const out = c.result();
    if (out.status !== 202) return out;
    const id = (out.body as { id?: string }).id ?? "";
    return {
      status: 202,
      body: {
        id,
        target: built.body.target,
        mode: built.body.mode,
        scope: built.body.scope,
        localHost: true,
        summary:
          `Local engagement ${id} launched against this machine (${built.body.target}, mode ${built.body.mode}). ` +
          "Inventory and posture are collected on-host; the report will carry the host-inventory sections. " +
          "Poll engagement_status with this id and narrate each phase change in the thread; " +
          "when it completes, call engagement_report and deliver the report here.",
      },
    };
  },
};

/** The local launch surface, appended to the cockpit list. */
export const LOCAL_TOOLS: ToolDef[] = [localLaunchTool];
