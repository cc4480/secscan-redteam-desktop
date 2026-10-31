import { type NfsDialFn } from "./connection.js";
export interface NfsExport {
    export: string;
    groups: string[];
}
export interface NfsEnumerateArgs {
    host: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}
/** Structural interface so tests inject a fake (no network). */
export interface NfsTransport {
    enumerateExports(args: NfsEnumerateArgs): Promise<NfsExport[]>;
    close(): Promise<void>;
}
export declare function createNfsTransport(dial?: NfsDialFn): NfsTransport;
