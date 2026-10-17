/**
 * Wordlist resolution for the content-discovery bridges (ffuf, gobuster).
 *
 * The bridges need a filesystem path, but the *operator's* path is not the
 * runner's path: a packaged desktop app cannot assume `C:\Users\<dev>\...`, and
 * an unattended engagement should not fail because one environment variable is
 * unset. So resolve in a fixed order and hand back the first candidate that
 * actually exists, instead of embedding one machine's absolute path in the
 * argv (which is what v0.32.0 did — every ffuf run failed on a fresh install).
 *
 * Order, most specific first:
 *   1. an explicit `wordlist` tool argument
 *   2. REDTEAM_WORDLIST
 *   3. <REDTEAM_TOOLS_DIR>/wordlists/common.txt   (bundled tools directory)
 *   4. the asset shipped inside this package: <runner>/assets/wordlists/common.txt
 *   5. <LOCALAPPDATA|HOME>/SecScanRedTeam/wordlists/common.txt (operator override)
 *
 * Pure and synchronous — testable without a subprocess and cheap enough to call
 * per tool invocation.
 */
/** All candidate paths, in precedence order. The caller picks the first that exists. */
export declare function wordlistCandidates(explicit?: string, env?: NodeJS.ProcessEnv): string[];
/**
 * Resolve a usable wordlist path, or `undefined` when none of the candidates
 * exists. `undefined` is the honest answer: the bridge then returns the setup
 * instructions rather than spawning a tool that is guaranteed to fail.
 */
export declare function resolveWordlist(explicit?: string, env?: NodeJS.ProcessEnv): string | undefined;
