import { ExecutorCore } from "./core.js";
import { type HostExecResult } from "./types.js";
export declare function nfsEnumImpl(core: ExecutorCore, args: {
    host: string;
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
/**
 * SSH agent-forwarding audit (batteries LX-018/LX-019).
 *
 * Preflight order: scope → SSH credential resolution →
 * denylist on the FIXED audit command (mechanical backstop even though
 * the command is not agent-supplied) → local agent socket resolution
 * (fails fast when no agent is available).
 *
 * The SAME ssh transport runs with `agentForward: true` and the
 * operator's local agent socket — then executes ONE fixed read-only
 * command. The forwarded socket is OBSERVED ONLY (ANALYSIS ONLY): it is
 * never used for onward authentication. That is the whole point of the
 * battery — detecting the exposure, not exploiting it.
 */
