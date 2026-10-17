/**
 * Readiness report — "is this installation actually able to run an engagement?"
 *
 * The product's promise is that an installed app is ready to use. Today that
 * promise is only true if a list of external things happens to be in place:
 * the bridge binaries (nmap, ffuf, …), a wordlist, the Metasploit RPC daemon,
 * and the three credentials the engine reads from the environment. When any of
 * them is missing the failure surfaced *late and one tool at a time* — mid
 * engagement, as `spawn nmap ENOENT` or `missing REDTEAM_SMB_USER` — which is
 * exactly the class of problem a first-run check should eliminate.
 *
 * This module is the mechanical answer: one pure-ish probe that names every
 * requirement, whether it is satisfied, and the fix when it is not. The CLI
 * exposes it as `redteam-runner doctor`; the desktop app can render the same
 * report on first run and offer to install the bundled tool payloads.
 *
 * Design rules: never throw, never touch a target, and keep every probe cheap
 * (one version spawn per binary, one 1s TCP connect for the RPC daemon).
 */
import { type XToolId } from "../xtool/registry.js";
export type ReadinessState = "ready" | "missing" | "unreachable" | "not-configured";
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
 * Build the full readiness report.
 *
 * `env` is injectable for tests; the RPC probe is async because it opens a
 * socket, so the whole report is async.
 */
export declare function readinessReport(env?: NodeJS.ProcessEnv): Promise<ReadinessReport>;
/** Render a report as a plain-text table for the CLI. */
export declare function formatReadiness(report: ReadinessReport): string;
export type { XToolId };
