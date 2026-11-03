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
import { type ReadinessItem, type ReadinessReport } from './readiness-items.js';
export { credentialPoolItem, formatReadiness } from './readiness-format.js';
export type { ReadinessItem, ReadinessReport, ReadinessState } from './readiness-items.js';
export { probeBinary, probeTcp } from './readiness-items.js';
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
export type { XToolId };
