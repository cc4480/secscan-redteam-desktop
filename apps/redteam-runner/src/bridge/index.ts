/**
 * Gated AlterEgo bridge client for the fleet (Q-BRIDGE-TOOLS, core).
 *
 * "Gated" names the real gates, in order: the bridge must be paired (token
 * file), must answer initialize, and its own native consent dialog decides
 * destructive calls. There is no client-side tool allowlist — the client
 * exposes and forwards the bridge's full registry (Carlos's order,
 * 2026-10-31).
 */
export { createBridgeClient, type BridgeClientOptions } from "./client.js";
export {
  BRIDGE_ENV_TOKEN_FILE,
  BRIDGE_ENV_URL,
  DEFAULT_BRIDGE_URL,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  defaultBridgeTokenFile,
  readBridgeToken,
  resolveBridgeConfig,
  resolveBridgeEndpoint,
  type BridgeConfigOverrides,
} from "./config.js";
export { snapshotBridgeRegistry } from "./registry.js";
export {
  BridgeError,
  type BridgeCallResult,
  type BridgeClient,
  type BridgeConfig,
  type BridgeErrorCode,
  type BridgeRegistrySnapshot,
  type BridgeToolDef,
} from "./types.js";
