export interface SmbPthArgs {
    host: string;
    port?: number;
    username: string;
    /** 32 lowercase hex chars — the test account's own NT hash. */
    ntHashHex: string;
    domain?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface SmbPthResult {
    reachable: boolean;
    /** Set only when the handshake ran to a verdict. */
    hashAccepted?: boolean;
    dialect?: string;
    /** Raw NTSTATUS of the final SESSION_SETUP, hex. */
    ntStatus?: string;
    note: string;
}
/** Structural interface so tests inject a fake (or a loopback test server). */
export interface SmbPthTransport {
    auth(args: SmbPthArgs): Promise<SmbPthResult>;
    close(): Promise<void>;
}
export declare const STATUS_SUCCESS = 0;
export declare const STATUS_LOGON_FAILURE = 3221225581;
export declare function u16le(n: number): Buffer;
export declare function u32le(n: number): Buffer;
export declare function u64le(n: number): Buffer;
export declare function smb2Header(command: number, messageId: number, sessionId?: number): Buffer;
export declare function netbiosWrap(payload: Buffer): Buffer;
export declare function buildNegotiate(messageId: number): Buffer;
export declare function buildSessionSetup(messageId: number, securityBlob: Buffer, sessionId?: number): Buffer;
export declare function buildLogoff(messageId: number, sessionId: number): Buffer;
export declare const DIALECT_NAMES: Record<number, string>;
