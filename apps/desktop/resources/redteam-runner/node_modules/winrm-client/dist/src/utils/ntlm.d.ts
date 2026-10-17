export interface TargetInfo {
    parsed: Record<string, string>;
    buffer: Buffer;
    flags: number;
    timestamp: Buffer | null;
}
export interface Type2Message {
    flags: number;
    encoding: BufferEncoding;
    version: number;
    challenge: Buffer;
    targetName: string;
    targetInfo?: TargetInfo;
}
/**
 * Create NTLM Type 1 (Negotiate) message.
 * Returns "NTLM <base64>" string.
 */
export declare function createType1Message(workstation: string, domain: string): string;
export declare function decodeType2Message(str: string): Type2Message;
/**
 * Create NTLM Type 3 (Authenticate) message.
 * Supports MIC when the server's Type 2 requests it via MsvAvFlags.
 *
 * Returns { message, type1Bytes } so the caller can provide type1Bytes
 * for MIC computation if needed. In practice, MIC is computed here
 * and the caller just needs the message string.
 */
export declare function createType3Message(type2Message: Type2Message, username: string, password: string, workstation: string, target: string, type1Bytes?: Buffer, type2Bytes?: Buffer): string;
