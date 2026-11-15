/**
 * Local Metasploit client factory for the exploit arm. The framework runs
 * natively on this host: the `msfconsole` binary is resolved through the
 * shared toolchain resolver (REDTEAM_MSFCONSOLE_BIN -> bundled payload ->
 * PATH) and probed by actually executing it (LocalMsfClient.login). There
 * are no credentials — `secrets` is always empty and exists only because
 * callers thread it into their redaction calls.
 * (Native replacement for the retired msfrpcd authedClient.)
 */

import { resolveExternalBinary } from "../../toolchain.js";
import { LocalMsfClient } from "../local-client.js";
import type { MsfDeps } from "./executor-types.js";

/**
 * Build a probed local client. Fail-fast: a missing or unrunnable
 * framework throws MsfAuthError carrying the native setup instructions —
 * never a silent unauthenticated attempt against nothing.
 */
export async function authedClient(
  deps: MsfDeps,
  _timeoutMs: number,
  _signal?: AbortSignal,
): Promise<{ client: LocalMsfClient; secrets: string[] }> {
  const resolved = resolveExternalBinary("msfconsole", { env: deps.env });
  const client = new LocalMsfClient({ bin: resolved.path, spawn: deps.spawn });
  await client.login();
  return { client, secrets: [] };
}
