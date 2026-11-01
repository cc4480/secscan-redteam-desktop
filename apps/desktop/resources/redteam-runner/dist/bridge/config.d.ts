import type { BridgeConfig } from "./types.js";
/** Environment variable naming the bridge base URL. */
export declare const BRIDGE_ENV_URL = "PC_BRIDGE_URL";
/** Environment variable naming the file the paired session token is read from. */
export declare const BRIDGE_ENV_TOKEN_FILE = "PC_BRIDGE_TOKEN_FILE";
/** Default bridge base URL: the app runs on the operator's own machine. */
export declare const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8765";
/** Default availability-probe timeout: a probe must be cheap. */
export declare const DEFAULT_PROBE_TIMEOUT_MS = 3000;
/** Default tools/list and tools/call timeout. */
export declare const DEFAULT_CALL_TIMEOUT_MS = 30000;
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
export declare function defaultBridgeTokenFile(platform?: NodeJS.Platform, homeDir?: string): string;
/**
 * Resolve the MCP endpoint for a configured base URL: a URL that already
 * carries a path is used as given; a bare origin gets the bridge's `/mcp`
 * path appended.
 * @param url - the configured bridge base URL.
 * @returns the full endpoint URL.
 */
export declare function resolveBridgeEndpoint(url: string): string;
/** Field overrides for {@link resolveBridgeConfig}; every field is optional. */
export interface BridgeConfigOverrides {
    readonly url?: string;
    readonly tokenFile?: string;
    readonly probeTimeoutMs?: number;
    readonly callTimeoutMs?: number;
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
export declare function resolveBridgeConfig(env?: NodeJS.ProcessEnv, overrides?: BridgeConfigOverrides): BridgeConfig;
/**
 * Read the paired session token from the configured token file.
 * The file holds exactly one bare token (AlterEgo's client token format).
 * @param config - resolved bridge configuration.
 * @returns the token, or undefined when the file is missing, empty, or
 *   unreadable — all of which mean "not paired", a normal state.
 */
export declare function readBridgeToken(config: BridgeConfig): string | undefined;
