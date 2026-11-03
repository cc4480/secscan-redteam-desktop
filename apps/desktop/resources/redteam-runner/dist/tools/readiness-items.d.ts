import { type ResolvedBinary } from "../toolchain.js";
export type ReadinessState = 'ready' | 'missing' | 'unreachable' | 'not-configured' | 'paused';
export interface ReadinessItem {
    /** Stable identifier used by the UI / tests. */
    id: string;
    /** Human label. */
    label: string;
    state: ReadinessState;
    /** What was found, when relevant (path, version, endpoint). */
    detail?: string;
    /** What to do when the state is not `ready`. */
    fix?: string;
    /** Required items block an engagement; optional ones only degrade it. */
    required: boolean;
}
export interface ReadinessReport {
    /** True when every required item is ready. */
    ok: boolean;
    items: ReadinessItem[];
    /** Short human summary, e.g. "3 of 9 ready — 2 required missing". */
    summary: string;
}
/** One version probe. Returns the first output line, or undefined when not runnable. */
export declare function probeBinary(bin: string, args: readonly string[]): string | undefined;
/** TCP reachability for the Metasploit RPC daemon (1s, no target traffic). */
export declare function probeTcp(host: string, port: number, timeoutMs?: number): Promise<boolean>;
/**
 * Detail line for a resolved binary: the path AND the source that picked it.
 * "Not found" is only actionable when the report says whether the operator's
 * env, the bundled tools directory or PATH was tried.
 */
export declare function resolvedDetail(resolved: ResolvedBinary, present: boolean): string;
