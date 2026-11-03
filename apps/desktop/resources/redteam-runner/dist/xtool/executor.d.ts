/**
 * External-tool resolver + executor (v0.32.0).
 *
 * Owns process spawning and the honest reading of results. Policy lives in
 * registry.ts and is pure; nothing here decides what may run — it runs an argv
 * it is handed and reports what came back.
 */
import { type XToolSpec } from "./registry.js";
export interface XSpawnOpts {
    file: string;
    args: string[];
    cwd?: string;
    timeoutMs: number;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
}
export interface XSpawnResult {
    stdout: string;
    stderr: string;
    code: number | null;
    timedOut: boolean;
}
export type XSpawnFn = (opts: XSpawnOpts) => Promise<XSpawnResult>;
export declare const realXSpawn: XSpawnFn;
/**
 * Resolve the binary (or, for the script tools, the directory they run from).
 *
 * The precedence lives in toolchain.ts and is shared with nmap and nuclei, so
 * "explicit env wins, then the bundled tools directory, then PATH" has exactly
 * one implementation. This wrapper exists so the executor's callers keep their
 * signature: resolveBinPath(spec, env) -> string.
 */
export declare function resolveBinPath(spec: XToolSpec, env?: NodeJS.ProcessEnv): string;
export declare function binPresent(spec: XToolSpec, env?: NodeJS.ProcessEnv): boolean;
export interface XExecResult {
    ok: boolean;
    tool: string;
    action: string;
    message: string;
    /** Structured findings when the tool's output is machine-readable. */
    findings?: XFinding[];
    binary?: string;
}
export interface XFinding {
    kind: string;
    target: string;
    detail: string;
}
/**
 * Pull ffuf's JSON records into findings. ffuf emits one JSON object per line
 * on stdout; anything that does not parse is skipped rather than throwing,
 * because a partial run must still report what it found.
 */
export declare function parseFfufJsonl(stdout: string, target: string): XFinding[];
/** gobuster's `-q` output is one path per line. */
export declare function parseGobusterText(stdout: string, target: string): XFinding[];
export declare function runXTool(spec: XToolSpec, opts: {
    action: 'probe' | 'run';
    target: string;
    profileId: string;
    wordlist?: string;
    rateLimit: number;
    timeoutS: number;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
}, spawnFn?: XSpawnFn): Promise<XExecResult>;
