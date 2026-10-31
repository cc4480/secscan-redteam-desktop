/**
 * Authenticated msfrpcd client for the Metasploit bridge. Credential
 * resolution is fail-fast: missing REDTEAM_MSFRPC_USER/PASS throws with
 * setup instructions (never a silent unauthenticated attempt).
 * (Moved verbatim from MsfExecutor — same behavior as a free function.)
 */
import { MsfClient } from "../client.js";
import type { MsfDeps } from "./executor.js";
export declare function authedClient(deps: MsfDeps, timeoutMs: number, signal?: AbortSignal): Promise<{
    client: MsfClient;
    secrets: string[];
}>;
