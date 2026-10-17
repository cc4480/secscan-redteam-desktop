export interface NfsConnection {
    write(data: Buffer): Promise<void>;
    /** Read one complete RPC reply record (record-marking handled). */
    readRecord(): Promise<Buffer>;
    close(): void;
}
export type NfsDialFn = (host: string, port: number, timeoutMs: number, signal?: AbortSignal) => Promise<NfsConnection>;
export declare function defaultNfsDial(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<NfsConnection>;
