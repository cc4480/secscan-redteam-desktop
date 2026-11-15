/**
 * Metasploit prerequisite probe — native edition.
 *
 * The exploit arm runs the framework installed on THIS host: availability
 * means the `msfconsole` binary resolves through the shared toolchain
 * resolver (REDTEAM_MSFCONSOLE_BIN -> bundled payload -> PATH) AND actually
 * executes `--version`. Resolving a path is not evidence; executing it is
 * (the nmap probe's rule). Called at readiness/ledger build, never on a hot
 * path, and cached because a probe per item would spawn a process per item.
 */
import { execFileSync } from "node:child_process";
import { resolveExternalBinary, type ResolvedBinary } from "../toolchain.js";

let probeCache: boolean | undefined;

/** Test-only: reset the cached probe so env changes take effect. */
export function _resetMsfProbeCache(): void {
  probeCache = undefined;
}

/** Where msfconsole would come from and why — no probe, no spawn. */
export function resolveMsfConsoleCommand(env: NodeJS.ProcessEnv = process.env): ResolvedBinary {
  return resolveExternalBinary("msfconsole", { env });
}

/** True when the local Metasploit framework is installed and runnable. */
export function msfBinaryPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  if (probeCache !== undefined) return probeCache;
  const candidate = resolveMsfConsoleCommand(env).path;
  try {
    execFileSync(candidate, ["--version"], { stdio: "ignore", timeout: 15_000 });
    probeCache = true;
  } catch {
    probeCache = false;
  }
  return probeCache;
}
