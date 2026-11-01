import { type ToolDef } from "./mcp-tools.js";
import type { UiLaunchRequest } from "./types.js";
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
export declare function buildLocalLaunchBody(a: Record<string, unknown>, host?: string): {
    body: UiLaunchRequest;
};
/** The local launch surface, appended to the cockpit list. */
export declare const LOCAL_TOOLS: ToolDef[];
