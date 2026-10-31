export interface RdpChannel {
    write(b: Buffer): void;
    readExactly(n: number, timeoutMs: number): Promise<Buffer>;
    /** Take whatever is currently buffered (may be empty). */
    drain(): Buffer;
    /** Upgrade the underlying socket to TLS (CredSSP runs inside TLS). */
    startTls(): Promise<void>;
    close(): void;
}
export interface RdpTransport {
    open(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<RdpChannel>;
    close(): Promise<void>;
}
export declare function createRdpTransport(): RdpTransport;
