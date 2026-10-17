import { type HostCredentials } from "../common.js";
import type { AdTransport } from "./transport.js";
export type AdOperation = "users" | "groups" | "computers" | "trusts" | "ous" | "gpos" | "acls" | "attack_paths" | "adcs";
export interface AdEnumArgs {
    host: string;
    port?: number;
    useTls?: boolean;
    baseDn?: string;
    creds: HostCredentials;
    operations: AdOperation[];
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface AdEnumResult {
    ok: boolean;
    baseDn?: string;
    /** Per-operation summaries (redacted, capped by the executor). */
    sections: {
        operation: AdOperation;
        summary: string;
        findingCount: number;
    }[];
    note: string;
}
export declare function adEnumerate(transport: AdTransport, args: AdEnumArgs): Promise<AdEnumResult>;
