export interface DangerousAce {
    targetDn: string;
    granteeSid: string;
    rights: string[];
    mask: number;
}
export declare function parseSid(buf: Buffer, offset: number): {
    sid: string;
    next: number;
};
/**
 * Parse a BINARY security descriptor (base64) and return ACEs granting
 * dangerous rights. Pure function — tested directly.
 */
export declare function findDangerousAces(dn: string, sdB64: string): DangerousAce[];
/** Well-known low-privilege SIDs that must never hold dangerous rights. */
export declare function isLowPrivSid(sid: string, domainSid: string): boolean;
/** Tier-0 SIDs: never flagged as findings when they hold dangerous rights. */
export declare function isTier0Sid(sid: string, domainSid: string): boolean;
