/**
 * Readiness item types and probes — extracted from readiness.ts to keep the
 * readiness module under the 300-line budget. Never throws, never touches a target.
 */
import { execFileSync } from "node:child_process";
import { connect as netConnect } from "node:net";
import { describeSource } from "../toolchain.js";
/** One version probe. Returns the first output line, or undefined when not runnable. */
export function probeBinary(bin, args) {
    try {
        const out = execFileSync(bin, [...args], { stdio: 'pipe', timeout: 8000, encoding: 'utf8' });
        return String(out).split('\n')[0]?.trim() || 'present';
    }
    catch {
        return undefined;
    }
}
/** TCP reachability for the Metasploit RPC daemon (1s, no target traffic). */
export function probeTcp(host, port, timeoutMs = 1000) {
    return new Promise((resolve) => {
        const socket = netConnect({ host, port });
        const done = (reachable) => {
            socket.destroy();
            resolve(reachable);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}
/**
 * Detail line for a resolved binary: the path AND the source that picked it.
 * "Not found" is only actionable when the report says whether the operator's
 * env, the bundled tools directory or PATH was tried.
 */
export function resolvedDetail(resolved, present) {
    return `${resolved.path} [from ${describeSource(resolved)}]${present ? '' : ' -- not found'}`;
}
//# sourceMappingURL=readiness-items.js.map