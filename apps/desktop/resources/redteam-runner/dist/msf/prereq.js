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
import { resolveExternalBinary } from "../toolchain.js";
let probeCache;
/** Test-only: reset the cached probe so env changes take effect. */
export function _resetMsfProbeCache() {
    probeCache = undefined;
}
/** Where msfconsole would come from and why — no probe, no spawn. */
export function resolveMsfConsoleCommand(env = process.env) {
    return resolveExternalBinary("msfconsole", { env });
}
/** True when the local Metasploit framework is installed and runnable. */
export function msfBinaryPresent(env = process.env) {
    if (probeCache !== undefined)
        return probeCache;
    const candidate = resolveMsfConsoleCommand(env).path;
    try {
        execFileSync(candidate, ["--version"], { stdio: "ignore", timeout: 15_000 });
        probeCache = true;
    }
    catch {
        probeCache = false;
    }
    return probeCache;
}
//# sourceMappingURL=prereq.js.map