import type { BolaIdentity } from "../src/types.js";
export declare const API_PROBE_COUNT = 4;
export declare function exposedUserListInCapture(jsonText: string, source: string): any | null;
export declare function exposedCredentialListInCapture(jsonText: string, source: string): any | null;
export declare function runApiSecProbes(url: string, host: string, headers: Record<string, string>, opts?: {
    bolaIdentities?: [BolaIdentity, BolaIdentity];
}): Promise<any[]>;
