export declare function rpcCall(prog: number, vers: number, proc: number, args: Buffer): Buffer;
export declare function rpcXid(call: Buffer): number;
/** Error carrying the RPC accept status so callers can decide on fallback. */
export declare class RpcAcceptError extends Error {
    readonly acceptStatus: number;
    constructor(message: string, acceptStatus: number);
}
/** Accept status codes (RFC 1831): 0 SUCCESS, 1 PROG_UNAVAIL, 2 PROG_MISMATCH, 3 PROC_UNAVAIL, 4 GARBAGE_ARGS, 5 SYSTEM_ERR. */
export declare const RPC_PROG_MISMATCH = 2;
/** Parse an RPC reply record; returns the procedure-result bytes. Throws on reject/failure. */
export declare function parseRpcReply(record: Buffer, xid: number): Buffer;
