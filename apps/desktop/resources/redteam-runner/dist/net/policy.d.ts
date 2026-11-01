export declare const NET_ENV_NPING_BIN = "REDTEAM_NPING_BIN";
/** Open socket sessions per engagement (socket shell). */
export declare const NET_MAX_OPEN_SOCKETS = 32;
/** Largest single socket_send payload. */
export declare const NET_MAX_SOCKET_PAYLOAD_BYTES: number;
/** Largest single socket_recv return. */
export declare const NET_MAX_RECV_BYTES: number;
export declare const NET_CONNECT_TIMEOUT_MS = 10000;
export declare const NET_SOCKET_IDLE_TIMEOUT_MS = 120000;
/** Largest crafted-packet payload (hex-supplied). */
export declare const NET_MAX_PACKET_PAYLOAD_BYTES = 4096;
/** Crafted packets per packet_send call. */
export declare const NET_MAX_PACKET_COUNT = 10;
export declare const NET_NPING_TIMEOUT_MS = 20000;
/** Flood hard cap: packets/connections per second, sustained. */
export declare const FLOOD_MAX_RATE_PER_SEC = 1000;
/** Flood hard cap: total run time. */
export declare const FLOOD_MAX_DURATION_MS = 30000;
/** Flood hard cap: simultaneous in-flight connections/senders. */
export declare const FLOOD_MAX_CONCURRENCY = 64;
/** Flood hard cap: payload bytes per packet/datagram. */
export declare const FLOOD_MAX_PAYLOAD_BYTES = 1400;
export declare const FLOOD_MODES: readonly ["tcp-connect", "tcp-data", "udp"];
export type FloodMode = (typeof FLOOD_MODES)[number];
export type PacketProtocol = "tcp" | "udp" | "icmp";
/** A validated crafted-packet specification (all fields runner-checked). */
export interface PacketSpec {
    protocol: PacketProtocol;
    /** Destination IPv4 literal — packet crafting never resolves names. */
    destIp: string;
    sourceIp?: string;
    sourcePort?: number;
    destPort?: number;
    tcpFlags?: string[];
    seq?: number;
    ack?: number;
    window?: number;
    ttl?: number;
    identification?: number;
    icmpType?: number;
    icmpCode?: number;
    icmpId?: number;
    icmpSeq?: number;
    payloadHex?: string;
    count: number;
}
type Raw = Record<string, unknown>;
/**
 * Validate the flat packet_send arguments into a PacketSpec.
 * @param raw - the tool call arguments (packet fields at top level).
 * @param destIp - the call's host argument.
 * @returns the spec, or the refusal reason.
 */
export declare function validatePacketSpec(raw: Raw, destIp: string): {
    ok: true;
    spec: PacketSpec;
} | {
    ok: false;
    reason: string;
};
/**
 * nping argv for a validated spec — runner-built, target last (it is a
 * validated IPv4 literal, so it can never be read as a flag).
 * @param nping - the resolved nping binary path.
 * @param spec - a validated PacketSpec.
 * @returns the argv (binary at index 0).
 */
export declare function buildNpingArgv(nping: string, spec: PacketSpec): string[];
/**
 * Resolve the nping binary: explicit env wins; otherwise the sibling of the
 * resolved nmap binary (nping ships in the same install). When nmap itself
 * resolves to a bare PATH name, nping is the bare name too.
 * @param env - environment to read overrides from.
 * @returns the nping path to spawn (existence is proven by the spawn).
 */
export declare function resolveNpingBinary(env?: NodeJS.ProcessEnv): string;
/** Flood parameters after the hard caps are applied. */
export interface FloodParams {
    mode: FloodMode;
    ratePerSec: number;
    durationMs: number;
    concurrency: number;
    payloadBytes: number;
    /** Human-readable notes for every value the caps moved. */
    clamped: string[];
}
/**
 * Resolve requested flood parameters against the hard caps: values above a
 * cap are clamped DOWN and named in `clamped`; values that are not positive
 * integers are refused.
 * @param raw - the tool call arguments.
 * @returns the effective parameters, or the refusal reason.
 */
export declare function resolveFloodParams(raw: Raw): {
    ok: true;
    params: FloodParams;
} | {
    ok: false;
    reason: string;
};
export {};
