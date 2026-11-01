/**
 * Bridge configuration: environment resolution and token-file reading.
 *
 * The bridge (AlterEgo's pc-agent) is an MCP streamable-HTTP server on the
 * operator's own machine. Its base URL comes from `PC_BRIDGE_URL` and
 * defaults to loopback; the MCP endpoint path is `/mcp` (the path the
 * bridge's own operator client POSTs to). The paired session token is read
 * from a FILE at call time — the file named by `PC_BRIDGE_TOKEN_FILE`, or the
 * bridge's own client token location by default — and is never accepted as a
 * value through config, never logged, and never printed, not even a prefix.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
/** Environment variable naming the bridge base URL. */
export const BRIDGE_ENV_URL = "PC_BRIDGE_URL";
/** Environment variable naming the file the paired session token is read from. */
export const BRIDGE_ENV_TOKEN_FILE = "PC_BRIDGE_TOKEN_FILE";
/** Default bridge base URL: the app runs on the operator's own machine. */
export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8765";
/** Default availability-probe timeout: a probe must be cheap. */
export const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
/** Default tools/list and tools/call timeout. */
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;
/**
 * The bridge's own client token location: `~/.config/pc-bridge/token`, the
 * path AlterEgo's token_store.py writes (Path.home()-based), resolved with
 * the target platform's separators so a Windows path is built correctly from
 * any host. On Windows the home directory is the user profile, so the default
 * resolves under it.
 * @param platform - platform to resolve for; defaults to the running platform.
 * @param homeDir - home directory to resolve under; defaults to os.homedir().
 * @returns the default token file path.
 */
export function defaultBridgeTokenFile(platform = process.platform, homeDir = homedir()) {
    const joiner = platform === "win32" ? win32.join : posix.join;
    return joiner(homeDir, ".config", "pc-bridge", "token");
}
/**
 * Resolve the MCP endpoint for a configured base URL: a URL that already
 * carries a path is used as given; a bare origin gets the bridge's `/mcp`
 * path appended.
 * @param url - the configured bridge base URL.
 * @returns the full endpoint URL.
 */
export function resolveBridgeEndpoint(url) {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (path === "")
        parsed.pathname = "/mcp";
    return parsed.toString();
}
/**
 * Resolve the full bridge configuration: environment first, then defaults.
 * An explicitly set but malformed `PC_BRIDGE_URL` resolves to the default
 * endpoint rather than throwing here — availability probing reports the
 * bridge as unavailable, which is the honest state for a bad address.
 * @param env - environment to read; defaults to process.env.
 * @param overrides - explicit field overrides, winning over env and defaults.
 * @returns the resolved configuration.
 */
export function resolveBridgeConfig(env = process.env, overrides = {}) {
    let url = (overrides.url ?? env[BRIDGE_ENV_URL] ?? "").trim();
    if (url === "")
        url = DEFAULT_BRIDGE_URL;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            url = DEFAULT_BRIDGE_URL;
    }
    catch {
        url = DEFAULT_BRIDGE_URL;
    }
    const tokenFile = overrides.tokenFile
        ?? ((env[BRIDGE_ENV_TOKEN_FILE] ?? "").trim() || defaultBridgeTokenFile());
    return {
        url,
        endpoint: resolveBridgeEndpoint(url),
        tokenFile,
        probeTimeoutMs: overrides.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        callTimeoutMs: overrides.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    };
}
/**
 * Read the paired session token from the configured token file.
 * The file holds exactly one bare token (AlterEgo's client token format).
 * @param config - resolved bridge configuration.
 * @returns the token, or undefined when the file is missing, empty, or
 *   unreadable — all of which mean "not paired", a normal state.
 */
export function readBridgeToken(config) {
    let raw;
    try {
        raw = readFileSync(config.tokenFile, "utf8");
    }
    catch {
        return undefined;
    }
    const token = raw.trim();
    return token === "" ? undefined : token;
}
//# sourceMappingURL=config.js.map