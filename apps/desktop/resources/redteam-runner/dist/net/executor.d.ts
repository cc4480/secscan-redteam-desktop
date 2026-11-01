import { type SpawnFn } from "../nmap/runner.js";
import { type FloodParams, type PacketSpec } from "./policy.js";
import { SocketSessions, type SocketOpenResult, type SocketProtocol, type SocketRecvResult } from "./sockets.js";
export interface NetDeps {
    spawn?: SpawnFn;
    env?: NodeJS.ProcessEnv;
}
export interface PacketSendResult {
    ok: boolean;
    message: string;
    /** The exact packet the spec describes, built runner-side (hex). */
    referenceHex: string;
    /** nping's RCVD lines — the replies it captured, verbatim. */
    replies: string[];
    sentLines: number;
}
export interface FloodRunResult {
    ok: boolean;
    message: string;
    sent: number;
    errors: number;
    elapsedMs: number;
    stoppedReason: "duration cap" | "aborted";
    params: FloodParams;
}
/** The net_exec executor: socket sessions + crafted packets + bounded flood. */
export declare class NetExecutor {
    readonly sessions: SocketSessions;
    private readonly spawn;
    private readonly env;
    constructor(deps?: NetDeps);
    /** Routes + hard caps. Touches no target. */
    caps(): string;
    socketOpen(args: {
        protocol: SocketProtocol;
        host: string;
        port: number;
        signal?: AbortSignal;
    }): Promise<SocketOpenResult>;
    socketSend(handle: string, data: Buffer): Promise<{
        ok: boolean;
        sent: number;
        message: string;
    }>;
    socketRecv(handle: string, maxBytes: number, timeoutMs: number): Promise<SocketRecvResult>;
    socketClose(handle: string): {
        ok: boolean;
        message: string;
    };
    /** The exact packet bytes a spec describes (source 0.0.0.0 when unspecified: the sender's real address). */
    referencePacket(spec: PacketSpec): Buffer;
    /**
     * Send a validated crafted-packet spec via nping and capture its replies.
     * @param spec - a policy-validated PacketSpec (scope already checked by dispatch).
     * @param signal - the call's abort signal.
     * @returns nping's outcome plus the reference packet hex.
     */
    sendPacket(spec: PacketSpec, signal?: AbortSignal): Promise<PacketSendResult>;
    /**
     * Run the bounded flood. Params arrive pre-clamped from policy; the caps
     * are re-applied here so no caller can exceed them.
     * @param args - target + effective params + abort signal.
     * @returns run statistics and why the run stopped.
     */
    flood(args: {
        host: string;
        port: number;
        params: FloodParams;
        signal?: AbortSignal;
    }): Promise<FloodRunResult>;
}
