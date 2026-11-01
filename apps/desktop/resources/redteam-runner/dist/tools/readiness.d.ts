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
import { type XToolId } from '../xtool/registry.js';
import { type PoolSnapshot } from '@secscan/redteam-llm-router';
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
 * Build the full readiness report.
 *
 * `env` is injectable for tests; the RPC probe is async because it opens a
 * socket, so the whole report is async.
 */
export declare function readinessReport(env?: NodeJS.ProcessEnv): Promise<ReadinessReport>;
/**
 * The `arsenal_index` readiness item (arsenal spec §11): `ready` when a
 * generation is serving, with the serving generation's stamp as the
 * detail — `generation N · M entries · built <date>`; `missing` with
 * the §7.1 fix text when no generation has been built yet. The state
 * reflects the SERVING generation, so a failed refresh that kept the
 * old index still reads `ready` with the old build date visible.
 *
 * Never throws (the report's standing rule): a misconfigured
 * REDTEAM_ARSENAL_* variable or an unreadable index file degrades to
 * `missing` with the error named in the detail — the /mcp endpoint
 * still fails loud on the same misconfiguration per request. Pure over
 * `env` + the index file, so tests point it at fixture homes.
 */
export declare function arsenalIndexItem(env: NodeJS.ProcessEnv): ReadinessItem;
/**
 * The `llm_credential_pool` readiness item (pool-persistence spec §1.6):
 * rendered ONLY when some pool entry is dead or benched — a healthy or
 * empty pool omits the item entirely rather than taking a green line.
 * The detail names each affected key by fingerprint (never key material):
 * dead keys with their recorded reason, benched (key, model) pairs with
 * the time until they are eligible again, or "no automatic return" for
 * permanent (entitlement) benches. Benches that have already lapsed by
 * render time are skipped. Pure over the snapshots so tests feed it
 * fixtures; the report builder passes the router's live poolSnapshots().
 */
export declare function credentialPoolItem(snapshots: PoolSnapshot[], nowMs: number): ReadinessItem | undefined;
/** Render a report as a plain-text table for the CLI. */
export declare function formatReadiness(report: ReadinessReport): string;
export type { XToolId };
