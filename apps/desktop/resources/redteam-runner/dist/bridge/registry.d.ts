/**
 * Registry snapshot: a probe-time record of everything the bridge offers.
 *
 * This exists so Builder B and the supervisor can verify full exposure —
 * that the fleet sees the bridge's complete registry, destructive ops
 * included. It is evidence, not a filter: nothing in the client consults a
 * snapshot before listing or calling.
 */
import type { BridgeClient, BridgeRegistrySnapshot } from "./types.js";
/**
 * Probe a bridge client and record what it offers.
 * @param client - the client to probe.
 * @returns the snapshot; `available: false` with an empty tool list when the
 *   bridge cannot be reached or is not paired.
 */
export declare function snapshotBridgeRegistry(client: BridgeClient): Promise<BridgeRegistrySnapshot>;
