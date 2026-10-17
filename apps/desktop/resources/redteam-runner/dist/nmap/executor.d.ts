/**
 * Nmap executor (v0.31.0) — the bridge the nmap_exec tool calls.
 *
 * Two actions, mirroring the nuclei bridge:
 *   profiles() — read the built-in profile table and confirm the binary runs.
 *                Touches no target, so it is safe in any phase.
 *   scan()     — run ONE profile against ONE scope-checked host.
 *
 * Policy decisions live in policy.ts and are pure; this class owns the spawn
 * and the honest reading of its result. It never builds a flag itself — it asks
 * policy for an argv and runs it.
 */
import { type SpawnFn, type NmapRunResult } from "./runner.js";
export interface NmapDeps {
    spawn?: SpawnFn;
    env?: NodeJS.ProcessEnv;
}
export interface NmapProfileInfo {
    id: string;
    description: string;
    minTier: number;
    args: string;
}
export interface NmapExecResult {
    ok: boolean;
    action: string;
    /** Human-readable result for the agent — the refusal reason when !ok. */
    message: string;
    profiles?: NmapProfileInfo[];
    binary?: string;
    version?: string;
    run?: NmapRunResult;
}
export declare class NmapExecutor {
    /**
     * Kill switch, same contract as NucleiExecutor: the dispatcher hands the
     * engagement's hostKill here, and a scan refuses to start once aborted. The
     * scan already receives the controller's AbortSignal, so an IN-FLIGHT nmap is
     * killed too — this flag is what stops the next one from starting.
     */
    killSwitch: {
        aborted: boolean;
    };
    private readonly spawn;
    private readonly env;
    constructor(deps?: NmapDeps);
    /** The catalogue. Recon-safe: runs `nmap --version`, never touches a target. */
    profiles(): Promise<NmapExecResult>;
    /**
     * Run one profile against one host.
     *
     * `target` is expected to have been scope-checked by the caller (the dispatch
     * layer owns the ROE host check) — this method builds an argv, runs it, and
     * reports what happened, including a refusal from policy.
     */
    scan(args: {
        target: string;
        profile: string;
        scriptCategories?: string[];
        extraFlags?: string[];
        rateLimit: number;
        timeoutS?: number;
        skipPing?: boolean;
        signal?: AbortSignal;
    }): Promise<NmapExecResult>;
}
