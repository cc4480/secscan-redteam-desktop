/**
 * Credential dumping for the MSF executor (W8): gather credential
 * material from an in-scope host through its open session and SEAL the
 * raw output into the engagement evidence store.
 *
 * The perimeter is the session perimeter (executor/session-ops.ts):
 * exact scope preflight, runner-issued handle bound to the
 * exploited host, post modules limited to the policy allowlist and
 * pinned to the open session. The tool result carries counts, types, the
 * evidence reference and a sha256 — the raw material never enters the
 * result, the event log, or the transcript.
 */
import type { MsfResult } from "./executor.js";
import { type SessionOpsHost } from "./session-ops.js";
export interface CredentialDumpArgs {
    host: string;
    scopeHosts: string[];
    handle: string;
    kind: string;
    evidenceDir: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface DumpKindSpec {
    /** Post module (with prefix) — absent for kiwi, which is a session extension. */
    module?: string;
    types: string[];
}
/** Credential-dump kinds the tool exposes. Post modules are the policy allowlist; kiwi runs through the session. */
export declare const DUMP_KINDS: Record<string, DumpKindSpec>;
export declare function dumpKindNames(): string[];
/** Count credential records in raw dump output (SAM lines + labelled secret pairs). */
export declare function countCredentialRecords(raw: string): number;
/**
 * Gather credential material through an open session and seal it.
 * See the header for the result contract (refs only, never raw).
 */
export declare function credentialDump(host: SessionOpsHost, args: CredentialDumpArgs): Promise<MsfResult>;
