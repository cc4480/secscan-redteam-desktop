export declare const PROTOCOL_HYBRID = 2;
export declare const PROTOCOL_HYBRID_EX = 8;
export declare function buildX224ConnectionRequest(): Buffer;
export type RdpNegResult = {
    kind: "selected";
    protocol: number;
} | {
    kind: "failure";
    code: number;
};
/** Parse an X.224 Connection Confirm carrying an RDP negotiation response. */
export declare function parseX224ConnectionConfirm(buf: Buffer): RdpNegResult;
export declare function protocolName(p: number): string;
