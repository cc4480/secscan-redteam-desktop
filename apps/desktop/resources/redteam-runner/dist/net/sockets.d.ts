export type SocketProtocol = "tcp" | "udp";
export interface SocketOpenResult {
    ok: boolean;
    handle?: string;
    localPort?: number;
    message: string;
}
export interface SocketRecvResult {
    ok: boolean;
    data: Buffer;
    message: string;
}
/** Live socket sessions for one engagement (one NetExecutor owns one set). */
export declare class SocketSessions {
    private readonly sessions;
    private seq;
    /** Number of currently open sessions. */
    get openCount(): number;
    /** The peer a handle was opened against, or undefined when unknown/closed. */
    peerOf(handle: string): {
        host: string;
        port: number;
        protocol: SocketProtocol;
    } | undefined;
    private armIdle;
    private destroy;
    private pushChunk;
    /**
     * Open a session to host:port.
     * @param args - protocol, target, and the caller's abort signal.
     * @returns the handle and local port, or the failure reason.
     */
    open(args: {
        protocol: SocketProtocol;
        host: string;
        port: number;
        signal?: AbortSignal;
    }): Promise<SocketOpenResult>;
    /**
     * Send bytes on an open session.
     * @param handle - a handle from open().
     * @param data - the bytes (already cap-checked by the caller; re-checked here).
     * @returns bytes written, or the failure reason.
     */
    send(handle: string, data: Buffer): Promise<{
        ok: boolean;
        sent: number;
        message: string;
    }>;
    /**
     * Drain received bytes FIFO, waiting up to timeoutMs for the first chunk.
     * @param handle - a handle from open().
     * @param maxBytes - return cap (clamped to NET_MAX_RECV_BYTES).
     * @param timeoutMs - how long to wait when the buffer is empty.
     * @returns the bytes read (possibly empty on timeout — a result, not an error).
     */
    recv(handle: string, maxBytes: number, timeoutMs: number): Promise<SocketRecvResult>;
    /**
     * Close one session.
     * @param handle - a handle from open().
     * @returns whether a live session was closed.
     */
    close(handle: string): {
        ok: boolean;
        message: string;
    };
    /** Close every session (engagement teardown). */
    closeAll(): void;
}
