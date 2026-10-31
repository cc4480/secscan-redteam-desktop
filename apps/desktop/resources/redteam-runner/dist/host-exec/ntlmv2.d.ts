/**
 * Shared NTLMv2 / CredSSP / DER primitives (v0.10.0).
 *
 * Pure functions, no network — used by rdp.ts (NLA credential validation)
 * and smb.ts (pass-the-hash with NTLMv2 from an NT hash). Kept in one place
 * so the two protocol implementations can't drift apart.
 *
 * MD4: Node's OpenSSL 3 build has MD4 disabled, and js-md4's fast path
 * (node crypto) throws on this runtime — so md4bytes() deliberately uses
 * js-md4's PURE-JS implementation via md4.create() (verified against the
 * known NT hash of "password": 8846f7eaee8fb117ad06bdd830b7586c).
 */
/** MD4 digest (16 bytes), pure-JS — the NT hash primitive. */
export declare function md4bytes(data: Uint8Array): Buffer;
/** NT hash = MD4(UTF-16LE(password)). */
export declare function ntHash(password: string): Buffer;
/**
 * NTOWFv2 per MS-NLMP 3.3.2: HMAC-MD5(NT_hash, UTF16LE(UPPER(user) + domain)).
 * The NT hash IS the NTLMv2 key — which is exactly why pass-the-hash works:
 * no password is needed once the hash is known.
 */
export declare function ntowfv2(user: string, domain: string, hash: Buffer): Buffer;
/** Standard client flags: UNICODE|OEM|REQUEST_TARGET|NTLM|ALWAYS_SIGN|EXTENDED_SESSION|VERSION|128|56. */
export declare const NTLM_FLAGS = 557575;
/** NTLMSSP NEGOTIATE (Type 1). */
export declare function buildType1(domain?: string, workstation?: string): Buffer;
export interface Type2 {
    flags: number;
    challenge: Buffer;
    targetInfo: Buffer;
    targetName: string;
}
/** Parse an NTLMSSP CHALLENGE (Type 2). Throws on malformed input. */
export declare function parseType2(buf: Buffer): Type2;
/**
 * NTLMSSP AUTHENTICATE (Type 3) with NTLMv2, keyed by a precomputed NT hash
 * (pass-the-hash) — or by a password-derived hash; the construction is
 * identical once the 16-byte key exists.
 */
export declare function buildType3V2(opts: {
    user: string;
    domain: string;
    workstation?: string;
    challenge: Buffer;
    targetInfo: Buffer;
    ntHash: Buffer;
    clientNonce?: Buffer;
}): Buffer;
export declare function derLen(n: number): Buffer;
/** SPNEGO NegTokenInit wrapping a raw NTLMSSP token (Type 1). */
export declare function spnegoInit(ntlmToken: Buffer): Buffer;
/** SPNEGO NegTokenResp wrapping a raw NTLMSSP token (Type 3). negState 1 = accept-incomplete. */
export declare function spnegoResp(ntlmToken: Buffer): Buffer;
/** CredSSP TSRequest: [0] version INTEGER, [1] negoTokens OCTET STRING. */
export declare function tsRequest(negoToken: Buffer, version?: number): Buffer;
interface DerNode {
    tag: number;
    content: Buffer;
    children: DerNode[];
}
export declare function derParse(buf: Buffer): DerNode;
/**
 * Extract the NTLM token from a server CredSSP TSResponse: walk
 * SEQ -> [1] negoTokens -> NegTokenResp SEQ -> [2] responseToken.
 */
export declare function tsResponseNtlmToken(tsResp: Buffer): Buffer;
export {};
